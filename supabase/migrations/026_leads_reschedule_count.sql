-- ===================================================================
-- 026_leads_reschedule_count.sql — Track reschedule counts per lead
-- ===================================================================
-- Closes GAP-C2/C3 quick-win from workflow-architect:
--   Cal.com webhook fires BOOKING_RESCHEDULED on each reschedule. Before
--   this migration, we just overwrote the status — couldn't tell "this
--   visitor rescheduled 4 times" (probable ghost) from "rescheduled once".
--
-- The chat-health-alerts cron now has a rule that fires when a lead has
-- reschedule_count >= 3, so Steven can ping manually before the visitor
-- ghosts the engagement entirely.
-- ===================================================================

alter table public.leads
  add column if not exists reschedule_count integer not null default 0;

create index if not exists idx_leads_high_reschedule
  on public.leads (reschedule_count)
  where reschedule_count >= 3;
