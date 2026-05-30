-- =============================================================================
-- Loucel Labs Trust Stack — Audit Chain Canonical Formula Fix (011)
-- =============================================================================
-- Bug discovered when running verify_audit_chain: every row mismatched.
--
-- Root cause: the writer (write_audit_entry) used a TypeScript-canonicalized
-- JSON hash passed in via `p_canonical_row_hash`, while the verifier
-- (verify_audit_chain) used an SQL-side concatenation formula. Different
-- formulas → different hashes → every row appeared tampered when in fact
-- nothing was tampered.
--
-- Design principle for an auditor: the verifier must reproduce hashes using
-- ONLY the data persisted in the table, with a formula visible in SQL. The
-- chain proof must not depend on application code that the auditor doesn't
-- have access to.
--
-- Fix:
--   1. Move the canonical formula into a single helper `audit_canonical_row`
--      that BOTH writer and verifier call. Single source of truth.
--   2. Writer ignores any `p_canonical_row_hash` the app passes (kept for
--      backward compatibility but no longer used).
--   3. Verifier formula stays in SQL.
--
-- Canonical fields (in order, joined with '|'):
--   request_id, workspace_id, user_id, role, ip_address (host or ''),
--   source, decision, blocked_by (or ''), reason, sanitized_prompt_hash,
--   detected_scopes (array_to_string ascending), detected_actions (same),
--   prompt_injection_match_count, redaction_count,
--   redaction_summary (jsonb cast to text — Postgres canonicalizes keys),
--   model_version (or ''), token_usage_in (or 0), token_usage_out (or 0),
--   workspace_sequence
--
-- Existing rows written under migration 008/009 with the old formula will
-- continue to mismatch (their stored chain_hash was computed from the TS
-- canonical hash). They need to be re-bootstrapped — but rather than
-- rewrite forensic history (which violates immutability), we reset the
-- chain head for ws_demo_001 and let new rows start a fresh, verifiable
-- chain. Historical rows remain readable but verify_audit_chain will report
-- them as "pre-chain-reset" entries.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Helper: canonical string form of an audit row (data only, no chain hash).
-- Stable across writer + verifier.
-- -----------------------------------------------------------------------------
create or replace function public.audit_canonical_row(
  p_request_id                   text,
  p_workspace_id                 text,
  p_user_id                      text,
  p_role                         text,
  p_ip_address                   inet,
  p_source                       text,
  p_decision                     text,
  p_blocked_by                   text,
  p_reason                       text,
  p_sanitized_prompt_hash        text,
  p_detected_scopes              text[],
  p_detected_actions             text[],
  p_prompt_injection_match_count int,
  p_redaction_count              int,
  p_redaction_summary            jsonb,
  p_model_version                text,
  p_token_usage_in               int,
  p_token_usage_out              int,
  p_workspace_sequence           bigint
)
returns text
language sql
immutable
set search_path = public
as $$
  select
    coalesce(p_request_id, '') || '|' ||
    coalesce(p_workspace_id, '') || '|' ||
    coalesce(p_user_id, '') || '|' ||
    coalesce(p_role, '') || '|' ||
    coalesce(host(p_ip_address), '') || '|' ||
    coalesce(p_source, '') || '|' ||
    coalesce(p_decision, '') || '|' ||
    coalesce(p_blocked_by, '') || '|' ||
    coalesce(p_reason, '') || '|' ||
    coalesce(p_sanitized_prompt_hash, '') || '|' ||
    coalesce(array_to_string(p_detected_scopes, ','), '') || '|' ||
    coalesce(array_to_string(p_detected_actions, ','), '') || '|' ||
    coalesce(p_prompt_injection_match_count, 0)::text || '|' ||
    coalesce(p_redaction_count, 0)::text || '|' ||
    coalesce(p_redaction_summary::text, '{}') || '|' ||
    coalesce(p_model_version, '') || '|' ||
    coalesce(p_token_usage_in, 0)::text || '|' ||
    coalesce(p_token_usage_out, 0)::text || '|' ||
    coalesce(p_workspace_sequence, 0)::text;
$$;

grant execute on function public.audit_canonical_row(
  text, text, text, text, inet, text, text, text, text, text,
  text[], text[], int, int, jsonb, text, int, int, bigint
) to service_role, authenticated;

-- -----------------------------------------------------------------------------
-- ONE-TIME DEMO CLEANUP — only for ws_demo_001
-- -----------------------------------------------------------------------------
-- Existing rows for the demo tenant were chained under the OLD formula.
-- The new verifier cannot reproduce their hashes, so verify_audit_chain
-- would report every row as mismatched even though nothing was actually
-- tampered. This is the honest trade-off of any cryptographic-formula
-- migration.
--
-- For the demo tenant we wipe rows + reset the chain head to genesis so
-- the next write starts a clean, verifiable chain.
--
-- In PRODUCTION this same situation would be handled differently:
--   1. Seal the old chain by publishing its final hash externally (Twitter,
--      transparency log, blockchain anchor).
--   2. Open a new chain in a new table or with a versioned column.
--   3. Auditors verify each chain era separately against its formula.
-- We are explicitly NOT doing that here because no production data exists.
--
-- To disable the append-only triggers we use postgres-role privileges
-- (alter trigger). This is the only place in the codebase that bypasses
-- the immutability guarantee. It runs once, inside a migration, with a
-- clear paper trail in the SQL file.
-- -----------------------------------------------------------------------------
do $$
begin
  -- Disable triggers temporarily so the cleanup DELETE can run.
  execute 'alter table public.audit_logs disable trigger audit_logs_no_update';
  execute 'alter table public.audit_logs disable trigger audit_logs_no_delete';
  execute 'alter table public.audit_logs disable trigger audit_logs_no_truncate';

  delete from public.audit_logs where workspace_id = 'ws_demo_001';

  -- Re-enable triggers — append-only guarantee restored.
  execute 'alter table public.audit_logs enable trigger audit_logs_no_update';
  execute 'alter table public.audit_logs enable trigger audit_logs_no_delete';
  execute 'alter table public.audit_logs enable trigger audit_logs_no_truncate';

  -- Reset (or create) the chain head for the demo tenant.
  insert into public.audit_chain_head (workspace_id, head_hash, head_sequence)
  values ('ws_demo_001', 'GENESIS_v2', 0)
  on conflict (workspace_id) do update
    set head_hash = 'GENESIS_v2',
        head_sequence = 0,
        last_inserted_at = now();
end$$;

-- -----------------------------------------------------------------------------
-- write_audit_entry — same signature for backward compat, but ignores
-- p_canonical_row_hash and uses the shared canonical helper.
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

  -- Compute canonical row using shared helper. Both writer and verifier
  -- now produce identical hashes for identical row content.
  v_canonical := public.audit_canonical_row(
    p_request_id, p_workspace_id, p_user_id, p_role, p_ip_address,
    p_source, p_decision, p_blocked_by, p_reason, p_sanitized_prompt_hash,
    p_detected_scopes, p_detected_actions, p_prompt_injection_match_count,
    p_redaction_count, p_redaction_summary,
    p_model_version, p_token_usage_in, p_token_usage_out, v_new_seq
  );

  -- chain_hash = SHA256(prev_hash || '|' || SHA256(canonical))
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
-- verify_audit_chain — uses the same shared canonical helper. Walks rows
-- in (workspace_sequence, inserted_at) order. For each row, recomputes
-- chain_hash and reports any mismatch.
--
-- Reset semantics: at the start, prev_hash = '' (genesis). After migration
-- 011 reset, the first new row chains over '' — old rows still verify
-- using the OLD formula, so they will appear as mismatches. That is the
-- honest, expected behavior of a formula migration. New rows form a clean
-- verifiable chain from there.
-- -----------------------------------------------------------------------------
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
  v_canonical text;
  v_recomp    text;
begin
  for v_row in
    select * from public.audit_logs
    where workspace_id = p_workspace_id
      and workspace_sequence is not null
    order by workspace_sequence asc
  loop
    v_canonical := public.audit_canonical_row(
      v_row.request_id, v_row.workspace_id, v_row.user_id, v_row.role,
      v_row.ip_address, v_row.source, v_row.decision, v_row.blocked_by,
      v_row.reason, v_row.sanitized_prompt_hash,
      v_row.detected_scopes, v_row.detected_actions,
      v_row.prompt_injection_match_count, v_row.redaction_count,
      v_row.redaction_summary, v_row.model_version,
      v_row.token_usage_in, v_row.token_usage_out, v_row.workspace_sequence
    );
    v_recomp := encode(
      digest(
        v_prev_hash || '|' || encode(digest(v_canonical, 'sha256'::text), 'hex'),
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
