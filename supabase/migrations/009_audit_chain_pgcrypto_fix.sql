-- =============================================================================
-- Loucel Labs Trust Stack — Audit Chain pgcrypto Fix (009)
-- =============================================================================
-- Fix for migration 008: the SECURITY DEFINER functions had
-- `set search_path = public` but pgcrypto's `digest()` lives in the
-- `extensions` schema in Supabase, producing the error
--
--   function digest(text, unknown) does not exist
--
-- on every audit write.
--
-- Fix: include `extensions` in the search_path of both audit functions
-- (write_audit_entry, verify_audit_chain) so `digest` and `encode` resolve.
-- =============================================================================

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
  p_canonical_row_hash            text default null
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

  perform 1 from public.audit_chain_head where workspace_id = p_workspace_id for update;
  if not found then
    insert into public.audit_chain_head (workspace_id, head_hash, head_sequence)
    values (p_workspace_id, 'GENESIS', 0)
    on conflict (workspace_id) do nothing;
    perform 1 from public.audit_chain_head where workspace_id = p_workspace_id for update;
  end if;

  select head_hash, head_sequence
    into v_prev_hash, v_prev_seq
    from public.audit_chain_head
    where workspace_id = p_workspace_id;

  v_new_seq := v_prev_seq + 1;

  v_new_hash := encode(
    digest(
      coalesce(v_prev_hash, '') || '|' ||
      coalesce(p_canonical_row_hash,
        encode(digest(
          p_request_id || '|' || p_workspace_id || '|' || p_user_id || '|' ||
          p_role || '|' || coalesce(host(p_ip_address), '') || '|' ||
          p_source || '|' || p_decision || '|' ||
          coalesce(p_blocked_by, '') || '|' || p_reason || '|' ||
          p_sanitized_prompt_hash || '|' || v_new_seq::text,
          'sha256'::text
        ), 'hex')
      ),
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

-- Same fix for verify_audit_chain.
create or replace function public.verify_audit_chain(p_workspace_id text)
returns table (
  sequence       bigint,
  stored_hash    text,
  recomputed     text,
  inserted_at    timestamptz
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_prev_hash text := '';
  v_row       record;
  v_recomp    text;
begin
  for v_row in
    select * from public.audit_logs
    where workspace_id = p_workspace_id
    order by workspace_sequence asc nulls last, inserted_at asc
  loop
    v_recomp := encode(
      digest(
        v_prev_hash || '|' ||
        encode(digest(
          v_row.request_id || '|' || v_row.workspace_id || '|' || v_row.user_id || '|' ||
          v_row.role || '|' || coalesce(host(v_row.ip_address), '') || '|' ||
          v_row.source || '|' || v_row.decision || '|' ||
          coalesce(v_row.blocked_by, '') || '|' || v_row.reason || '|' ||
          v_row.sanitized_prompt_hash || '|' || coalesce(v_row.workspace_sequence, 0)::text,
          'sha256'::text
        ), 'hex'),
        'sha256'::text
      ),
      'hex'
    );
    if v_recomp is distinct from v_row.prev_row_hash then
      sequence := v_row.workspace_sequence;
      stored_hash := v_row.prev_row_hash;
      recomputed := v_recomp;
      inserted_at := v_row.inserted_at;
      return next;
    end if;
    v_prev_hash := v_row.prev_row_hash;
  end loop;
  return;
end;
$$;
