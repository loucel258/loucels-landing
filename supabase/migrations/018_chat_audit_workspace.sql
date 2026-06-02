-- =============================================================================
-- 018_chat_audit_workspace.sql
-- =============================================================================
-- Provisions audit support for the public-landing chat widget.
--
-- WHY THIS EXISTS
-- ---------------
-- The chat widget at the landing root is the first piece of Loucel itself
-- that exercises the Trust Stack end-to-end on real visitor traffic (DLP
-- redaction before model calls, audit log per event, no-PII Cal links).
-- To stay consistent with the architecture we sell, the chat must write
-- to audit_logs the same way the DLP/RBAC/HITL demos do — but isolated
-- to its own workspace so its traffic doesn't contaminate the public
-- scripted demo at /demo/audit.
--
-- THIS MIGRATION
-- --------------
-- 1. Provisions the `ws_chat_loucel_landing` client in public.clients.
-- 2. Scopes the existing audit_logs_demo_view to ws_demo_001 ONLY so
--    real chat traffic doesn't leak into the marketing demo page.
-- 3. Adds read_chat_session_audit(p_session_id) RPC so a visitor can see
--    THEIR OWN session's audit entries without exposing anyone else's.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- 1) Provision the chat workspace
-- ----------------------------------------------------------------------------
insert into public.clients (workspace_id, name, industry, status)
values
  ('ws_chat_loucel_landing', 'Loucel Labs — Landing Chat', 'self', 'active')
on conflict (workspace_id) do nothing;

-- Layer 2 fail-closed: NOT required for the marketing chat. A transient
-- Anthropic outage should not block a prospect from booking — Layer 1
-- regex DLP still runs.
update public.clients
   set layer2_required = false
 where workspace_id = 'ws_chat_loucel_landing';

-- ----------------------------------------------------------------------------
-- 2) Scope the public demo view to ws_demo_001 only
-- ----------------------------------------------------------------------------
-- Without this filter, every chat audit row would also appear in the
-- /demo/audit marketing page (even with user_id masked). That clutters
-- the scripted demo with noise from random visitors. The view also stays
-- security_definer (intentional — it is the controlled window onto the
-- locked-down table; Supabase Security Advisor flags this but it is by
-- design, mirrors migration 001's posture).
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
where workspace_id = 'ws_demo_001'
order by workspace_sequence desc nulls last, inserted_at desc;

-- ----------------------------------------------------------------------------
-- 3) Per-session reader RPC for "View this chat's audit trail" button
-- ----------------------------------------------------------------------------
-- A visitor's session_id (random 20-char token in sessionStorage) is
-- written into audit_logs.user_id when chat events fire. This RPC lets
-- THAT session's browser query its own rows back via the anon key,
-- without granting general SELECT on audit_logs.
--
-- Defense-in-depth:
--   - Length-bounded session_id (8..64 chars; matches the client format)
--   - Scoped to the chat workspace ONLY (cannot read demo rows or any
--     other tenant's data)
--   - Returns the redacted shape; raw prompts were never stored anyway
--     (only sanitized_prompt_hash), but we also omit IP and request_id
--     for the visitor-facing view.

create or replace function public.read_chat_session_audit(p_session_id text)
returns table (
  inserted_at        timestamptz,
  workspace_sequence bigint,
  source             text,
  decision           text,
  blocked_by         text,
  reason             text,
  prev_row_hash      text,
  redaction_count    integer,
  redaction_summary  jsonb,
  model_version      text,
  token_usage_in     integer,
  token_usage_out    integer
)
language sql
stable
security definer
set search_path = public
as $$
  select
    a.inserted_at,
    a.workspace_sequence,
    a.source,
    a.decision,
    a.blocked_by,
    a.reason,
    a.prev_row_hash,
    a.redaction_count,
    a.redaction_summary,
    a.model_version,
    a.token_usage_in,
    a.token_usage_out
  from public.audit_logs a
  where a.workspace_id = 'ws_chat_loucel_landing'
    and a.user_id = p_session_id
    and char_length(p_session_id) between 8 and 64
  order by a.workspace_sequence desc nulls last, a.inserted_at desc
  limit 100;
$$;

comment on function public.read_chat_session_audit(text) is
  'Returns the audit-log rows produced by a single landing-chat session, '
  'scoped to ws_chat_loucel_landing only. Safe for anon key — cannot read '
  'any other workspace or any session other than the one whose token is '
  'supplied. Used by the "View this chat''s audit trail" widget UI.';

grant execute on function public.read_chat_session_audit(text) to anon, authenticated;
