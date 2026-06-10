-- ===================================================================
-- 025_ops_notifications.sql — Internal alerts + nurture sequence tracking
-- ===================================================================
-- Supports two cron jobs:
--   1. /api/cron/chat-health-alerts (every 15 min): dedupes alerts_sent
--   2. /api/cron/nurture-sequence (daily): tracks sequence progress
--
-- Both tables RLS service-role only.
-- ===================================================================

-- Dedup table for chat-health-alerts cron — prevents email storms
create table if not exists alerts_sent (
  id          uuid primary key default gen_random_uuid(),
  rule_id     text not null,                     -- 'chat_unavailable' | 'chat_failed_spike' | ...
  subject     text not null,
  sent_at     timestamptz not null default now()
);

create index if not exists idx_alerts_sent_rule_recent
  on alerts_sent (rule_id, sent_at desc);

alter table alerts_sent enable row level security;

comment on table alerts_sent is 'Dedup ledger for /api/cron/chat-health-alerts. Each rule firing within 6h is suppressed using this table — no email storms during incident windows. Service-role only.';
