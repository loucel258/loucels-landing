-- 034_engagement_value_levers.sql
-- Per-agent knobs that drive the "Resumen" ROI math in the client portal.
-- All have safe defaults so a fresh deploy works without manual config.

alter table public.client_agents
  add column if not exists minutes_saved_per_conversation int not null default 5,
  add column if not exists conversation_retention_days int not null default 90;

comment on column public.client_agents.minutes_saved_per_conversation is
  'Used to compute "hours recovered" headline metric. Tunable per vertical: medspa intake ~6-8 min, restaurant ~3 min, contractor ~5 min.';

comment on column public.client_agents.conversation_retention_days is
  'TTL for conversation_messages rows scoped to this agent. Lower = stricter privacy, higher = longer client visibility.';

-- Audit allowlist additions for the new HITL events triggered by the
-- portal endpoints.
alter table public.audit_logs
  drop constraint if exists audit_logs_source_check;

alter table public.audit_logs
  add constraint audit_logs_source_check
    check (source in ('dlp', 'rbac', 'hitl', 'vault', 'chat', 'webhook', 'portal'));

comment on constraint audit_logs_source_check on public.audit_logs is
  'Allowed audit source values. portal added so client-side HITL approvals are observable.';
