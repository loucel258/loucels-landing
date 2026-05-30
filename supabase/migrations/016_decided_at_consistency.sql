-- =============================================================================
-- 016_decided_at_consistency.sql
-- =============================================================================
-- Keeps pending_approvals.decided_at consistent with the actual decision
-- state. A row whose status is 'pending' should NEVER carry a non-null
-- decided_at: pending means "not yet decided." Today the rollback path
-- (approving → pending) preserves the old timestamp if one was ever
-- written, which makes forensic queries like "first decision time"
-- silently wrong after a saga rollback + retry cycle.
--
-- Fix: replace the stamping trigger so it also clears decided_at when
-- the row transitions back to 'pending' (sweeper rollback, manual
-- rollback, etc.). Idempotent — safe to run multiple times.
-- =============================================================================

create or replace function public.stamp_pending_approvals_decision()
returns trigger
language plpgsql
as $$
begin
  -- Stamp the timestamp on the FIRST entry into a terminal state.
  if new.status in ('approved', 'rejected')
     and old.status in ('pending', 'approving') then
    new.decided_at := now();
  end if;

  -- Clear the timestamp on any transition back to 'pending'. After a
  -- saga rollback the row is genuinely undecided again and the audit
  -- trail should reflect that.
  if new.status = 'pending' and old.status <> 'pending' then
    new.decided_at := null;
  end if;

  return new;
end;
$$;

-- Trigger already exists (migration 003); function replacement above is
-- enough. No re-create needed.

-- One-time backfill: any row currently in 'pending' with a stray
-- decided_at gets it nulled so historical data lines up with the new
-- invariant.
update public.pending_approvals
   set decided_at = null
 where status = 'pending' and decided_at is not null;
