-- 036_multi_tenant_agents.sql
-- Multi-tenant chat route foundation. Adds the columns that let a single
-- /api/agent/[slug]/chat endpoint serve every client — with their own
-- system prompt, allowed origins, tool set, and engagement scope.
--
-- Also closes the leads-leak security gap: until now `leads` had no
-- engagement_id, so the portal showed every lead across tenants. The
-- new column scopes leads per-engagement; the multi-tenant chat route
-- populates it at insert time.

-- =====================================================================
-- client_agents extensions
-- =====================================================================
alter table public.client_agents
  add column if not exists slug text,
  add column if not exists system_prompt text,
  add column if not exists allowed_origins text[] not null default '{}',
  add column if not exists tools_enabled text[] not null default '{request_booking,escalate_to_human}',
  add column if not exists greeting_message text,
  add column if not exists brand_color text,
  add column if not exists max_tokens_per_message int not null default 1024;

-- Unique slug across the whole platform — it's a public widget identifier
create unique index if not exists client_agents_slug_unique
  on public.client_agents (slug)
  where slug is not null;

comment on column public.client_agents.slug is
  'Public widget identifier. Used in /api/agent/[slug]/chat and embed code data-agent attribute. Not a secret; security comes from allowed_origins.';
comment on column public.client_agents.allowed_origins is
  'CORS / CSRF gate. Array of exact origin strings (https://acmemedspa.com). Requests with no matching Origin header are rejected with 403.';
comment on column public.client_agents.tools_enabled is
  'Whitelist of tool names the agent can call. The chat route filters the Claude tool list by this column before sending the API request.';

-- =====================================================================
-- leads: engagement scoping (closes the multi-tenant leak)
-- =====================================================================
alter table public.leads
  add column if not exists engagement_id uuid references public.engagements(id) on delete set null;

create index if not exists leads_engagement_idx
  on public.leads (engagement_id, created_at desc)
  where engagement_id is not null;

comment on column public.leads.engagement_id is
  'Which engagement this lead belongs to. Resolved from the agent.slug -> client_agents -> engagement chain at insert time. Null = legacy Loucels landing lead (pre-multi-tenant).';

-- =====================================================================
-- Audit allowlist: add 'agent' source for the new chat route
-- =====================================================================
alter table public.audit_logs
  drop constraint if exists audit_logs_source_check;

alter table public.audit_logs
  add constraint audit_logs_source_check
    check (source in ('dlp', 'rbac', 'hitl', 'vault', 'chat', 'webhook', 'portal', 'agent'));

comment on constraint audit_logs_source_check on public.audit_logs is
  'Allowed audit source values. agent = multi-tenant /api/agent/[slug]/chat path.';
