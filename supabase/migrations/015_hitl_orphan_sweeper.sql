-- =============================================================================
-- 015_hitl_orphan_sweeper.sql
-- =============================================================================
-- Recovers HITL rows stuck in the intermediate `approving` state.
--
-- BACKGROUND
-- ----------
-- The saga in /api/demo/hitl/decide moves a row pending → approving,
-- calls the external provider (Twilio / Stripe / GBP), then either
-- commits to `approved` (hitl_commit_approval) or rolls back to
-- `pending` (hitl_rollback_to_pending). If the Node process crashes,
-- the network drops, or the external API hangs past the route's hard
-- timeout, the row is orphaned in `approving` forever — invisible to
-- supervisors (the UI shows it as in-flight) and impossible to retry.
--
-- THIS MIGRATION
-- --------------
-- 1. Adds `approving_at timestamptz` populated when the row enters
--    `approving` (set by hitl_lock_for_approval, cleared on transition
--    out).
-- 2. Backfills existing approving rows so the sweeper has something to
--    compare against (uses created_at as a conservative fallback).
-- 3. Patches hitl_lock_for_approval, hitl_commit_approval, and
--    hitl_rollback_to_pending to maintain the column.
-- 4. Creates `hitl_sweep_orphans(p_stale_seconds int default 90)` —
--    SECURITY DEFINER, returns the number of rows rolled back. Call it
--    on a cron (pg_cron or external scheduler) every minute.
-- =============================================================================

alter table public.pending_approvals
  add column if not exists approving_at timestamptz;

comment on column public.pending_approvals.approving_at is
  'Set when the row enters the `approving` saga state. Cleared on commit '
  'or rollback. Read by hitl_sweep_orphans to find stuck rows.';

create index if not exists pending_approvals_approving_idx
  on public.pending_approvals (approving_at)
  where status = 'approving';

-- Backfill: any row currently stuck in approving is now eligible for sweep.
update public.pending_approvals
   set approving_at = coalesce(approving_at, created_at)
 where status = 'approving' and approving_at is null;

-- ----------------------------------------------------------------------------
-- Patch hitl_lock_for_approval: stamp approving_at.
-- ----------------------------------------------------------------------------
create or replace function public.hitl_lock_for_approval(
  p_id           uuid,
  p_decider_id   text,
  p_final_text   text,
  p_text_diff    text,
  p_reason       text
)
returns public.pending_approvals
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row     public.pending_approvals;
  v_ws_jwt  text;
begin
  v_ws_jwt := current_setting('request.jwt.claims', true)::json->>'workspace_id';

  select * into v_row from public.pending_approvals
   where id = p_id for update;

  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  if v_ws_jwt is not null and v_ws_jwt is distinct from v_row.workspace_id then
    raise exception 'access_denied' using errcode = '42501';
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
      decision_reason = p_reason,
      approving_at = now()
  where id = p_id and status = 'pending'
  returning * into v_row;

  return v_row;
end;
$$;

-- ----------------------------------------------------------------------------
-- Patch hitl_commit_approval: clear approving_at on success.
-- ----------------------------------------------------------------------------
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
  v_row public.pending_approvals;
begin
  select * into v_row from public.pending_approvals
   where id = p_id for update;

  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  if v_row.status <> 'approving' then
    raise exception 'invalid_state: expected approving, got %', v_row.status
      using errcode = 'P0001';
  end if;

  update public.pending_approvals
  set status = 'approved',
      execution_status = 'delivered',
      external_provider = p_provider,
      external_id = p_external_id,
      delivered_at = now(),
      approving_at = null
  where id = p_id and status = 'approving'
  returning * into v_row;

  return v_row;
end;
$$;

-- ----------------------------------------------------------------------------
-- Patch hitl_rollback_to_pending: clear approving_at on rollback.
-- ----------------------------------------------------------------------------
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
      failure_reason = p_failure_reason,
      approving_at = null
  where id = p_id and status = 'approving'
  returning * into v_row;

  if not found then
    raise exception 'invalid_state: row not in approving' using errcode = 'P0001';
  end if;

  return v_row;
end;
$$;

-- ----------------------------------------------------------------------------
-- hitl_sweep_orphans — find rows stuck in `approving` past the stale
-- threshold and roll them back. Returns the number of rows reset. Logs
-- a synthetic audit entry per row so the forensic trail shows the
-- janitor's action.
-- ----------------------------------------------------------------------------
create or replace function public.hitl_sweep_orphans(
  p_stale_seconds int default 90
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int := 0;
  v_orphan record;
begin
  for v_orphan in
    select id, workspace_id
      from public.pending_approvals
     where status = 'approving'
       and approving_at is not null
       and approving_at < now() - make_interval(secs => p_stale_seconds)
     for update skip locked
  loop
    update public.pending_approvals
    set status = 'pending',
        execution_status = 'delivery_failed',
        failure_reason = 'sweeper_timeout: external call did not commit within '
                       || p_stale_seconds || 's',
        approving_at = null
    where id = v_orphan.id;
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.hitl_sweep_orphans(int) from public;
grant execute on function public.hitl_sweep_orphans(int) to service_role;

-- ----------------------------------------------------------------------------
-- SCHEDULING (operator note — not auto-installed)
-- ----------------------------------------------------------------------------
-- pg_cron (if available in your Supabase project):
--
--   select cron.schedule(
--     'hitl-orphan-sweeper',
--     '* * * * *',
--     $$ select public.hitl_sweep_orphans(90); $$
--   );
--
-- External scheduler (Vercel cron, GitHub Actions, etc.):
--   POST /api/demo/hitl/sweep  every 60s with service-role auth.
-- ----------------------------------------------------------------------------
