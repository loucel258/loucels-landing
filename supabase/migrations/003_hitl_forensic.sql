-- =============================================================================
-- Loucel Labs Trust Stack — HITL Forensic + Execution Saga (Hito 4 upgrade)
-- =============================================================================
-- Closes two blind spots a CTO/Compliance Officer will press on:
--   1. Forensic diff:  store the agent's original draft AND the final approved
--      text, plus a unified diff between them. "Was it edited?" is replaced
--      with "what exactly was changed?"
--   2. Execution saga: approval is a multi-phase transaction.
--        pending → approving → approved (only after external API returns 200)
--        pending → approving → pending  (if external API fails; never silently
--                                         "approved" with no delivery)
--
-- Run AFTER 002_pending_approvals.sql.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Forensic + execution columns
-- -----------------------------------------------------------------------------
alter table public.pending_approvals
  add column if not exists final_text       text,
  add column if not exists text_diff        text,
  add column if not exists execution_status text default 'pending_execution',
  add column if not exists external_provider text,
  add column if not exists external_id      text,
  add column if not exists failure_reason   text,
  add column if not exists delivered_at     timestamptz;

-- Constrain execution_status values
alter table public.pending_approvals
  drop constraint if exists pending_approvals_exec_status_check;
alter table public.pending_approvals
  add constraint pending_approvals_exec_status_check
    check (
      execution_status in (
        'pending_execution',
        'delivering',
        'delivered',
        'delivery_failed'
      )
    );

-- Allow the new intermediate 'approving' status
alter table public.pending_approvals
  drop constraint if exists pending_approvals_status_check;
alter table public.pending_approvals
  add constraint pending_approvals_status_check
    check (status in ('pending', 'approving', 'approved', 'rejected'));

-- -----------------------------------------------------------------------------
-- State-machine trigger: rows in terminal status are frozen.
-- Once approved or rejected, no UPDATE is allowed — same forensic guarantee
-- as audit_logs but scoped to this table.
-- -----------------------------------------------------------------------------
create or replace function public.enforce_hitl_terminal_state()
returns trigger
language plpgsql
as $$
begin
  if old.status in ('approved', 'rejected') then
    raise exception
      'pending_approvals row in terminal state % cannot be modified',
      old.status;
  end if;
  return new;
end;
$$;

drop trigger if exists pending_approvals_terminal_lock on public.pending_approvals;
create trigger pending_approvals_terminal_lock
  before update on public.pending_approvals
  for each row execute function public.enforce_hitl_terminal_state();

-- -----------------------------------------------------------------------------
-- Re-stamp decided_at when leaving 'approving' (the previous stamp trigger
-- only checked pending → approved/rejected, so update it).
-- -----------------------------------------------------------------------------
create or replace function public.stamp_pending_approvals_decision()
returns trigger
language plpgsql
as $$
begin
  if new.status in ('approved', 'rejected')
     and old.status in ('pending', 'approving') then
    new.decided_at := now();
  end if;
  return new;
end;
$$;
