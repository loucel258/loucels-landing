-- 038_audit_source_allow_agent.sql
-- Extend the audit_logs source allowlist to include 'agent', emitted by
-- the multi-tenant chat route at /api/agent/[slug]/chat.
-- Without this, every audit write from that route fails the CHECK
-- constraint and is silently dropped by the try/catch in the route's
-- audit() helper.

alter table public.audit_logs
  drop constraint if exists audit_logs_source_check;

alter table public.audit_logs
  add constraint audit_logs_source_check
    check (source in ('dlp', 'rbac', 'hitl', 'vault', 'chat', 'webhook', 'portal', 'agent'));

comment on constraint audit_logs_source_check on public.audit_logs is
  'Whitelist of valid audit sources. Update when a new auditable module is introduced.';
