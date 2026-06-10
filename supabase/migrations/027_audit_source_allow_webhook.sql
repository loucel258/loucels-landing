-- 027_audit_source_allow_webhook.sql
-- Allow audit_logs.source = 'webhook' so signature failures and replay
-- rejections from Stripe/Cal/DocuSign/Tally land in the immutable chain
-- instead of being lost to console.warn.

alter table public.audit_logs
  drop constraint if exists audit_logs_source_check;

alter table public.audit_logs
  add constraint audit_logs_source_check
    check (source in ('dlp', 'rbac', 'hitl', 'vault', 'chat', 'webhook'));

comment on constraint audit_logs_source_check on public.audit_logs is
  'Allowed audit source values. Add new values here when a new module starts writing audit rows.';
