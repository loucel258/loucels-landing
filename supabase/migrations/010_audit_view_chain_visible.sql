-- =============================================================================
-- Loucel Labs Trust Stack — Expose Chain Metadata in Demo View (010)
-- =============================================================================
-- Migrations 008+009 added `prev_row_hash` (chain hash per row) and
-- `workspace_sequence` (monotonic per-tenant counter) to audit_logs, but
-- the `audit_logs_demo_view` was not updated to surface them. Demo UI
-- (`/demo/audit`) therefore couldn't show the chain working.
--
-- This migration drops and recreates the view with the chain columns
-- exposed. Same masking guarantees (user_id_masked, no raw IP).
-- =============================================================================

drop view if exists public.audit_logs_demo_view;

create view public.audit_logs_demo_view as
select
  id,
  inserted_at,
  request_id,
  workspace_id,
  workspace_sequence,
  substring(user_id, 1, length(user_id) - 4) || 'XXXX' as user_id_masked,
  role,
  source,
  decision,
  blocked_by,
  reason,
  sanitized_prompt_hash,
  prev_row_hash,
  detected_scopes,
  detected_actions,
  prompt_injection_match_count,
  redaction_count,
  redaction_summary,
  model_version,
  token_usage_in,
  token_usage_out
from public.audit_logs
order by workspace_id, workspace_sequence desc nulls last, inserted_at desc;

grant select on public.audit_logs_demo_view to anon, authenticated, service_role;
