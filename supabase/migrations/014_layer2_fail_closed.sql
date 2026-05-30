-- =============================================================================
-- 014_layer2_fail_closed.sql
-- =============================================================================
-- Adds a per-workspace policy flag that controls whether the Layer 2
-- (Claude Haiku) detectors are allowed to silently fall back to Layer 1
-- when the LLM is unreachable, OR must fail closed (the request is
-- rejected with a 503 instead of returning a less-protective result).
--
-- WHY THIS EXISTS
-- ---------------
-- Today both `sanitizeWithLLM` and `evaluateWithLLM` degrade gracefully:
-- if Anthropic times out or returns garbage, we still return a Layer 1
-- result and mark `layer2Available=false`. That is the right default for
-- the public demo (we never want a transient Anthropic outage to take
-- down a marketing page), but it is the WRONG default for a regulated
-- customer who explicitly bought the Layer 2 guarantee. A bank that
-- contracted "no prompts reach Claude without LLM-grade DLP" needs us
-- to refuse the request rather than ship a regex-only sanitization.
--
-- THIS MIGRATION
-- --------------
-- 1. Adds `layer2_required boolean not null default false` to
--    public.clients. Default keeps existing behavior (demo + low-risk
--    tenants).
-- 2. Adds a tiny SECURITY DEFINER lookup so server routes can read the
--    flag with a single round trip and without granting authenticated
--    callers full SELECT on the clients table.
-- =============================================================================

alter table public.clients
  add column if not exists layer2_required boolean not null default false;

comment on column public.clients.layer2_required is
  'When true, DLP/RBAC routes MUST return 503 if the Layer 2 LLM classifier '
  'is unavailable. When false (default), routes degrade to Layer 1 + audit '
  'note. Set true for regulated tenants with a contractual LLM-grade DLP '
  'requirement.';

-- ----------------------------------------------------------------------------
-- client_layer2_required(workspace_id) → boolean
-- Returns the flag for a workspace. Returns FALSE for unknown workspaces
-- (the demo workspace lives in audit_logs but may not have a clients row;
-- fail-closed only applies to provisioned tenants).
-- ----------------------------------------------------------------------------
create or replace function public.client_layer2_required(p_workspace_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select layer2_required from public.clients where workspace_id = p_workspace_id),
    false
  );
$$;

revoke all on function public.client_layer2_required(text) from public;
grant execute on function public.client_layer2_required(text) to service_role;
grant execute on function public.client_layer2_required(text) to authenticated;
