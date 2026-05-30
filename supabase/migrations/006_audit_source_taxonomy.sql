-- =============================================================================
-- Loucel Labs Trust Stack — Audit Source Taxonomy (006)
-- =============================================================================
-- Forensic improvement: distinguish between audit sources so an auditor can
-- separate RBAC denials, HITL approvals, vault reads, and DLP sanitizations
-- in their reports.
--
-- Previously: `source text not null` with no constraint. App code wrote
-- 'rbac' for HITL events as a shortcut. This migration enforces a clean
-- taxonomy at the DB level so app bugs cannot mis-label sources silently.
--
-- Allowed values:
--   'dlp'   — PII/secret sanitization layer
--   'rbac'  — role-based access control policy decisions
--   'hitl'  — human-in-the-loop queue events (propose, approve, reject, deliver, rollback)
--   'vault' — credential vault reads/writes
--
-- Backfill: existing rows that the demo wrote with source='rbac' but were
-- actually HITL events stay tagged as 'rbac' (we can't reliably re-classify
-- historic rows). New writes use the correct taxonomy from now on.
--
-- Run AFTER 005_workspace_isolation.sql.
-- =============================================================================

alter table public.audit_logs
  drop constraint if exists audit_logs_source_check;

alter table public.audit_logs
  add constraint audit_logs_source_check
  check (source in ('dlp', 'rbac', 'hitl', 'vault'));
