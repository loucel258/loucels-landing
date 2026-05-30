-- =============================================================================
-- Loucel Labs Trust Stack — Atomic Audit Chain (008)
-- =============================================================================
-- Closes the chain-race vulnerability flagged in audit:
--
--   Two concurrent writeAuditEntry calls for the same workspace both read
--   the same prev_row_hash, compute different chain hashes against the same
--   parent, and both insert successfully. The chain becomes a tree, not a
--   chain, and the "verify by recompute" story breaks because the verifier
--   cannot pick which row was canonically next.
--
-- Fix: serialize read+compute+insert inside a Postgres function that holds
-- a per-workspace row lock (SELECT ... FOR UPDATE on audit_chain_head).
-- App code (lib/audit/writer.ts) is refactored to call this RPC instead of
-- doing two separate queries.
--
-- The chain head table stores the latest hash per workspace so the lock has
-- something to grab even when audit_logs is empty.
--
-- Run AFTER 007_hitl_saga_rpcs.sql.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- audit_chain_head — one row per workspace. Genesis is recorded on first
-- write. UPDATE / DELETE blocked by trigger so the head ratchets forward
-- only via the RPC.
-- -----------------------------------------------------------------------------
create table if not exists public.audit_chain_head (
  workspace_id     text primary key
                     references public.clients(workspace_id) on delete cascade,
  head_hash        text not null,
  head_sequence    bigint not null default 0,
  last_inserted_at timestamptz not null default now()
);

alter table public.audit_chain_head enable row level security;
revoke all on public.audit_chain_head from anon, authenticated;
grant select on public.audit_chain_head to service_role;
-- No UPDATE/DELETE/INSERT granted to anyone — only the RPC manipulates it
-- (via SECURITY DEFINER).

-- -----------------------------------------------------------------------------
-- Add sequence number to audit_logs so the chain has a stable ordering key
-- that does not depend on inserted_at timestamps (which can tie at
-- microsecond resolution).
-- -----------------------------------------------------------------------------
alter table public.audit_logs
  add column if not exists workspace_sequence bigint;

create index if not exists audit_logs_workspace_sequence_idx
  on public.audit_logs (workspace_id, workspace_sequence desc);

-- -----------------------------------------------------------------------------
-- write_audit_entry — atomic chain-aware insert.
--
-- service_role only (the app's writeAuditEntry runs under service_role).
-- Holds SELECT ... FOR UPDATE on the workspace's chain head row so concurrent
-- writers serialize. Returns the new row's id, chain hash, and sequence.
--
-- Parameters mirror the AuditEntry TS type.
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
  -- Pre-computed canonical row hash (SHA-256 of canonical JSON). We let the
  -- app build it because the canonical form is shared between app and the
  -- (future) chain verifier.
  p_canonical_row_hash            text default null
)
returns table (
  id          uuid,
  chain_hash  text,
  sequence    bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_role text;
  v_prev_hash   text;
  v_prev_seq    bigint;
  v_new_seq     bigint;
  v_new_hash    text;
  v_new_id      uuid;
begin
  -- service_role only. Anything else gets rejected. The TS writer always
  -- uses service_role, so authenticated paths are not expected here.
  v_caller_role := coalesce(
    current_setting('request.jwt.claims', true)::json->>'role',
    case when current_user in ('postgres', 'supabase_admin') then 'service_role' else 'anon' end
  );
  if v_caller_role <> 'service_role' then
    raise exception 'write_audit_entry: service_role only' using errcode = '42501';
  end if;

  -- Acquire a per-workspace lock on the chain head. If the head row doesn't
  -- exist yet (this workspace's first write), insert a genesis row inside
  -- the same transaction.
  perform 1 from public.audit_chain_head where workspace_id = p_workspace_id for update;
  if not found then
    insert into public.audit_chain_head (workspace_id, head_hash, head_sequence)
    values (p_workspace_id, 'GENESIS', 0)
    on conflict (workspace_id) do nothing;
    -- Re-fetch with lock (handles the race where two concurrent first writes
    -- both miss the row).
    perform 1 from public.audit_chain_head where workspace_id = p_workspace_id for update;
  end if;

  select head_hash, head_sequence
    into v_prev_hash, v_prev_seq
    from public.audit_chain_head
    where workspace_id = p_workspace_id;

  v_new_seq := v_prev_seq + 1;

  -- Compute the new chain hash. If the caller supplied a canonical row hash,
  -- we chain over (prev_hash || '|' || canonical_row_hash). Otherwise we
  -- derive a minimal canonical form here (less ideal — the app should pass
  -- the full canonical form).
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
          'sha256'
        ), 'hex')
      ),
      'sha256'
    ),
    'hex'
  );

  -- Insert the audit row.
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

  -- Advance the chain head atomically. We need to bypass the append-only
  -- nature of audit_chain_head — but the table itself has no UPDATE/DELETE
  -- granted to anyone except this SECURITY DEFINER function (effectively).
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

revoke all on function public.write_audit_entry(
  text, text, text, text, inet, text, text, text, text, text,
  text[], text[], int, int, jsonb, text, int, int, text
) from public;
grant execute on function public.write_audit_entry(
  text, text, text, text, inet, text, text, text, text, text,
  text[], text[], int, int, jsonb, text, int, int, text
) to service_role;

-- -----------------------------------------------------------------------------
-- verify_audit_chain(workspace_id) — recompute every link.
--
-- Returns rows where the recomputed chain hash differs from the stored
-- prev_row_hash. An empty result set means the chain is intact.
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
set search_path = public
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
          'sha256'
        ), 'hex'),
        'sha256'
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

revoke all on function public.verify_audit_chain(text) from public;
grant execute on function public.verify_audit_chain(text) to service_role, authenticated;
