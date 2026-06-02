-- =============================================================================
-- 019_audit_source_allow_chat.sql
-- =============================================================================
-- Migration 018 provisioned the chat workspace but the audit_logs table
-- still rejects 'chat' as a `source` because of a pre-existing CHECK
-- constraint (`audit_logs_source_check`) that only allows the four
-- original Trust Stack sources: dlp / rbac / hitl / vault.
--
-- Symptom this fixes:
--   new row for relation "audit_logs" violates check constraint
--   "audit_logs_source_check"
--
-- WHY A NEW MIGRATION AND NOT AN EDIT TO 018
-- ------------------------------------------
-- 018 already ran on the live Supabase. Migrations are append-only.
-- =============================================================================

alter table public.audit_logs
  drop constraint if exists audit_logs_source_check;

alter table public.audit_logs
  add constraint audit_logs_source_check
    check (source in ('dlp', 'rbac', 'hitl', 'vault', 'chat'));

comment on constraint audit_logs_source_check on public.audit_logs is
  'Allowed audit source values. Add new values here when a new Trust Stack '
  'module starts writing audit rows.';
