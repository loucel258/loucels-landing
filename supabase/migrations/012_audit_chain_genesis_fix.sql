-- =============================================================================
-- Loucel Labs Trust Stack — Audit Chain Genesis Symmetry (012)
-- =============================================================================
-- Bug discovered in verify_audit_chain after migration 011: only the FIRST
-- row of every workspace's chain mismatched. Rows 2+ verified clean.
--
-- Root cause: writer and verifier disagreed on the GENESIS value.
--   - writer's first entry chained over the literal 'GENESIS' (or
--     'GENESIS_v2' after the migration-011 reset)
--   - verifier started walking with v_prev_hash := ''
-- So the first row's stored hash = SHA256('GENESIS_v2' || '|' || sha256(...))
-- but the verifier computed SHA256('' || '|' || sha256(...)) → mismatch
-- on row 1, then rows 2+ matched because the verifier picked up the stored
-- row-1 hash and chained forward from there.
--
-- Fix: standardize on empty string ('') as the genesis. Both writer and
-- verifier start from ''. The 'GENESIS' literal is removed.
--
-- Migration steps:
--   1. Recreate write_audit_entry with '' as the initial prev_hash when a
--      workspace's chain_head doesn't exist yet.
--   2. Reset ws_demo_001 chain_head to ('', 0) and wipe its rows so the
--      next write produces a row that the verifier can match exactly.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Recreate write_audit_entry with empty-string genesis.
-- -----------------------------------------------------------------------------
create or replace function public.write_audit_entry(
  p_request_id                    text,
  p_workspace_id                  text,
  p_user_id                       text,
  p_role                          text,
  p_ip_address                    inet,
  p_source                        text,
  p_decision                      text,
  p_blocked_by                    text,
  p_reason                        text,
  p_sanitized_prompt_hash         text,
  p_detected_scopes               text[] default '{}',
  p_detected_actions              text[] default '{}',
  p_prompt_injection_match_count  int default 0,
  p_redaction_count               int default 0,
  p_redaction_summary             jsonb default '{}'::jsonb,
  p_model_version                 text default null,
  p_token_usage_in                int default null,
  p_token_usage_out               int default null,
  p_canonical_row_hash            text default null  -- kept for back-compat, ignored
)
returns table (
  id          uuid,
  chain_hash  text,
  sequence    bigint
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_caller_role text;
  v_prev_hash   text;
  v_prev_seq    bigint;
  v_new_seq     bigint;
  v_canonical   text;
  v_new_hash    text;
  v_new_id      uuid;
begin
  v_caller_role := coalesce(
    current_setting('request.jwt.claims', true)::json->>'role',
    case when current_user in ('postgres', 'supabase_admin') then 'service_role' else 'anon' end
  );
  if v_caller_role <> 'service_role' then
    raise exception 'write_audit_entry: service_role only' using errcode = '42501';
  end if;

  -- Lock the workspace's chain head. If missing, initialize to ('', 0) —
  -- empty string as genesis matches the verifier's starting state.
  perform 1 from public.audit_chain_head where workspace_id = p_workspace_id for update;
  if not found then
    insert into public.audit_chain_head (workspace_id, head_hash, head_sequence)
    values (p_workspace_id, '', 0)
    on conflict (workspace_id) do nothing;
    perform 1 from public.audit_chain_head where workspace_id = p_workspace_id for update;
  end if;

  select head_hash, head_sequence
    into v_prev_hash, v_prev_seq
    from public.audit_chain_head
    where workspace_id = p_workspace_id;

  v_new_seq := v_prev_seq + 1;

  v_canonical := public.audit_canonical_row(
    p_request_id, p_workspace_id, p_user_id, p_role, p_ip_address,
    p_source, p_decision, p_blocked_by, p_reason, p_sanitized_prompt_hash,
    p_detected_scopes, p_detected_actions, p_prompt_injection_match_count,
    p_redaction_count, p_redaction_summary,
    p_model_version, p_token_usage_in, p_token_usage_out, v_new_seq
  );

  v_new_hash := encode(
    digest(
      coalesce(v_prev_hash, '') || '|' || encode(digest(v_canonical, 'sha256'::text), 'hex'),
      'sha256'::text
    ),
    'hex'
  );

  insert into public.audit_logs (
    request_id, workspace_id, user_id, role, ip_address, source,
    decision, blocked_by, reason, sanitized_prompt_hash,
    detected_scopes, detected_actions, prompt_injection_match_count,
    redaction_count, redaction_summary,
    model_version, token_usage_in, token_usage_out,
    prev_row_hash, workspace_sequence
  )
  values (
    p_request_id, p_workspace_id, p_user_id, p_role, p_ip_address, p_source,
    p_decision, p_blocked_by, p_reason, p_sanitized_prompt_hash,
    p_detected_scopes, p_detected_actions, p_prompt_injection_match_count,
    p_redaction_count, p_redaction_summary,
    p_model_version, p_token_usage_in, p_token_usage_out,
    v_new_hash, v_new_seq
  )
  returning audit_logs.id into v_new_id;

  update public.audit_chain_head
    set head_hash = v_new_hash,
        head_sequence = v_new_seq,
        last_inserted_at = now()
    where workspace_id = p_workspace_id;

  id := v_new_id;
  chain_hash := v_new_hash;
  sequence := v_new_seq;
  return next;
end;
$$;

-- -----------------------------------------------------------------------------
-- Wipe ws_demo_001 again and reset chain head to ('', 0). Same trigger-
-- bypass pattern as migration 011 — demo-only data cleanup.
-- -----------------------------------------------------------------------------
do $$
begin
  execute 'alter table public.audit_logs disable trigger audit_logs_no_update';
  execute 'alter table public.audit_logs disable trigger audit_logs_no_delete';
  execute 'alter table public.audit_logs disable trigger audit_logs_no_truncate';

  delete from public.audit_logs where workspace_id = 'ws_demo_001';

  execute 'alter table public.audit_logs enable trigger audit_logs_no_update';
  execute 'alter table public.audit_logs enable trigger audit_logs_no_delete';
  execute 'alter table public.audit_logs enable trigger audit_logs_no_truncate';

  update public.audit_chain_head
    set head_hash = '',
        head_sequence = 0,
        last_inserted_at = now()
    where workspace_id = 'ws_demo_001';
end$$;
