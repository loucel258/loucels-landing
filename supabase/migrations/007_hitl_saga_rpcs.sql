-- =============================================================================
-- Loucel Labs Trust Stack — HITL Saga RPC Enforcement (007)
-- =============================================================================
-- Closes a critical gap flagged in audit: the RLS policy on pending_approvals
-- allowed authenticated supervisors to UPDATE the table directly via
-- PostgREST, which bypassed the entire saga state machine. A malicious or
-- accidental direct UPDATE could move a row to `approved` without the
-- external API ever being called — defeating the whole "owned by you,
-- governed by us" promise.
--
-- This migration:
--   1. Revokes UPDATE / INSERT / DELETE on pending_approvals from
--      authenticated. Anon already had none. Only service_role keeps direct
--      mutation access (used by the saga in lib/hitl/queue.ts).
--   2. Adds two SECURITY DEFINER RPCs (`hitl_reject`, `hitl_lock_for_approval`)
--      that enforce the state machine at the DB layer for authenticated
--      callers (future use: supervisor consoles that don't go through our
--      Next.js backend).
--
-- Run AFTER 006_audit_source_taxonomy.sql.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Lock down direct mutations from authenticated context.
-- -----------------------------------------------------------------------------
drop policy if exists "tenant_update_pending_approvals" on public.pending_approvals;

-- SELECT stays — supervisors need to read the queue.
-- INSERT / UPDATE / DELETE: no policies for authenticated → denied by RLS.

revoke insert, update, delete on public.pending_approvals from authenticated;
-- anon already has nothing, but be explicit:
revoke insert, update, delete on public.pending_approvals from anon;

-- -----------------------------------------------------------------------------
-- hitl_reject(p_id, p_decider_id, p_reason)
--
-- Workspace-scoped: caller must match the row's workspace via JWT claim
-- (unless service_role). Transitions pending → rejected atomically. Returns
-- the updated row.
-- -----------------------------------------------------------------------------
create or replace function public.hitl_reject(
  p_id          uuid,
  p_decider_id  text,
  p_reason      text
)
returns public.pending_approvals
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_role text;
  v_caller_ws   text;
  v_row         public.pending_approvals;
begin
  v_caller_role := coalesce(
    current_setting('request.jwt.claims', true)::json->>'role',
    case when current_user in ('postgres', 'supabase_admin') then 'service_role' else 'anon' end
  );
  v_caller_ws := current_setting('request.jwt.claims', true)::json->>'workspace_id';

  if v_caller_role = 'anon' then
    raise exception 'access denied' using errcode = '42501';
  end if;

  select * into v_row from public.pending_approvals where id = p_id for update;
  if v_row.id is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  if v_caller_role = 'authenticated'
     and v_caller_ws is distinct from v_row.workspace_id then
    raise exception 'access denied' using errcode = '42501';
  end if;

  if v_row.status <> 'pending' then
    raise exception 'already_decided: %', v_row.status using errcode = 'P0001';
  end if;

  update public.pending_approvals
  set status = 'rejected',
      decider_id = p_decider_id,
      decision_reason = p_reason
  where id = p_id
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.hitl_reject(uuid, text, text) from public;
grant execute on function public.hitl_reject(uuid, text, text) to service_role, authenticated;

-- -----------------------------------------------------------------------------
-- hitl_lock_for_approval(p_id, p_decider_id, p_final_text, p_text_diff)
--
-- First phase of the saga. Atomically transitions pending → approving and
-- snapshots final_text + text_diff. The caller is then responsible for the
-- external API call; on success they call hitl_commit_approval, on failure
-- hitl_rollback_to_pending.
-- -----------------------------------------------------------------------------
create or replace function public.hitl_lock_for_approval(
  p_id          uuid,
  p_decider_id  text,
  p_final_text  text,
  p_text_diff   text,
  p_reason      text default null
)
returns public.pending_approvals
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_role text;
  v_caller_ws   text;
  v_row         public.pending_approvals;
begin
  v_caller_role := coalesce(
    current_setting('request.jwt.claims', true)::json->>'role',
    case when current_user in ('postgres', 'supabase_admin') then 'service_role' else 'anon' end
  );
  v_caller_ws := current_setting('request.jwt.claims', true)::json->>'workspace_id';

  if v_caller_role = 'anon' then
    raise exception 'access denied' using errcode = '42501';
  end if;

  select * into v_row from public.pending_approvals where id = p_id for update;
  if v_row.id is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  if v_caller_role = 'authenticated'
     and v_caller_ws is distinct from v_row.workspace_id then
    raise exception 'access denied' using errcode = '42501';
  end if;

  if v_row.status <> 'pending' then
    raise exception 'already_decided: %', v_row.status using errcode = 'P0001';
  end if;

  update public.pending_approvals
  set status = 'approving',
      execution_status = 'delivering',
      final_text = p_final_text,
      text_diff = p_text_diff,
      decider_id = p_decider_id,
      decision_reason = p_reason
  where id = p_id and status = 'pending'
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.hitl_lock_for_approval(uuid, text, text, text, text) from public;
grant execute on function public.hitl_lock_for_approval(uuid, text, text, text, text) to service_role, authenticated;

-- -----------------------------------------------------------------------------
-- hitl_commit_approval(p_id, p_provider, p_external_id)
--
-- Final saga commit. approving → approved + delivered_at + external metadata.
-- After this the trigger pending_approvals_terminal_lock freezes the row.
-- -----------------------------------------------------------------------------
create or replace function public.hitl_commit_approval(
  p_id          uuid,
  p_provider    text,
  p_external_id text
)
returns public.pending_approvals
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_role text;
  v_caller_ws   text;
  v_row         public.pending_approvals;
begin
  v_caller_role := coalesce(
    current_setting('request.jwt.claims', true)::json->>'role',
    case when current_user in ('postgres', 'supabase_admin') then 'service_role' else 'anon' end
  );
  v_caller_ws := current_setting('request.jwt.claims', true)::json->>'workspace_id';

  if v_caller_role = 'anon' then
    raise exception 'access denied' using errcode = '42501';
  end if;

  select * into v_row from public.pending_approvals where id = p_id for update;
  if v_row.id is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  if v_caller_role = 'authenticated'
     and v_caller_ws is distinct from v_row.workspace_id then
    raise exception 'access denied' using errcode = '42501';
  end if;

  if v_row.status <> 'approving' then
    raise exception 'invalid_state: expected approving, got %', v_row.status using errcode = 'P0001';
  end if;

  update public.pending_approvals
  set status = 'approved',
      execution_status = 'delivered',
      external_provider = p_provider,
      external_id = p_external_id,
      delivered_at = now()
  where id = p_id and status = 'approving'
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.hitl_commit_approval(uuid, text, text) from public;
grant execute on function public.hitl_commit_approval(uuid, text, text) to service_role;

-- -----------------------------------------------------------------------------
-- hitl_rollback_to_pending(p_id, p_provider, p_failure_reason)
--
-- approving → pending on external API failure. Keeps final_text + text_diff
-- so retries / forensics can see what was about to ship.
-- -----------------------------------------------------------------------------
create or replace function public.hitl_rollback_to_pending(
  p_id              uuid,
  p_provider        text,
  p_failure_reason  text
)
returns public.pending_approvals
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.pending_approvals;
begin
  -- Only service_role calls this (saga path from app code).
  if current_setting('request.jwt.claims', true)::json->>'role' = 'authenticated'
     or coalesce(current_setting('request.jwt.claims', true)::json->>'role', '') = 'anon' then
    if current_user not in ('postgres', 'supabase_admin') then
      raise exception 'access denied: rollback is service_role only' using errcode = '42501';
    end if;
  end if;

  update public.pending_approvals
  set status = 'pending',
      execution_status = 'delivery_failed',
      external_provider = p_provider,
      failure_reason = p_failure_reason
  where id = p_id and status = 'approving'
  returning * into v_row;

  if v_row.id is null then
    raise exception 'invalid_state: row not in approving' using errcode = 'P0001';
  end if;

  return v_row;
end;
$$;

revoke all on function public.hitl_rollback_to_pending(uuid, text, text) from public;
grant execute on function public.hitl_rollback_to_pending(uuid, text, text) to service_role;
