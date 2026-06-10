-- ===================================================================
-- 024_client_agents.sql — Per-client deployed agent tracking
-- ===================================================================
-- Foundation for Sprint 3D (admin/agent/[id]). Lets the admin track
-- agents deployed for paying clients separately from the loucellabs.com
-- landing chat (which lives in ws_chat_loucel_landing workspace).
--
-- The lifecycle of a deployed agent mirrors the build SOW phases:
--   designing -> shadow_mode -> uat -> live -> paused -> archived
--
-- Each row links back to an engagement (so the admin can navigate from
-- engagement → agent → conversations). Each agent has its own workspace_id
-- which is the bridge to the audit chain — audit rows for THIS agent's
-- conversations carry this workspace_id, so the per-agent observability
-- page just queries audit_logs WHERE workspace_id = <agent's workspace>.
-- ===================================================================

create table if not exists client_agents (
  id                  uuid primary key default gen_random_uuid(),

  -- Linkage to the engagement that spawned this agent
  engagement_id       uuid not null references engagements(id),
  engagement_ref      text not null,  -- denormalized for convenient queries

  -- Agent identity
  name                text not null,                -- e.g. "Denise" (client-facing display name)
  agent_type          text not null default 'ai_front_desk'
                        check (agent_type in (
                          'ai_front_desk',
                          'quote_accelerator',
                          'review_manager',
                          'operations_gap_audit',
                          'custom'
                        )),
  version             text default 'v0.1',

  -- Multi-tenant workspace id — this is the audit-chain bridge.
  -- Pattern: ws_client_<engagement_ref>_<agent_slug>
  -- Example: ws_client_oga20260615xyz_frontdesk
  workspace_id        text not null unique,

  -- Lifecycle
  status              text not null default 'designing'
                        check (status in (
                          'designing',      -- Phase 1: script being drafted
                          'shadow_mode',    -- Phase 3: shadow traffic, no real responses
                          'uat',            -- Phase 4: UAT review
                          'live',           -- Phase 5: receiving real traffic
                          'paused',         -- Manually paused by Steven
                          'archived'        -- Retainer cancelled
                        )),

  -- Where the agent operates
  channels            text[] default '{}',           -- ['web_chat', 'sms', 'whatsapp', 'email', 'gbp']
  integrations        jsonb default '{}'::jsonb,    -- {"crm":"jobnimbus","calendar":"calendly",...}

  -- Performance baselines (set on go-live, used to detect drift)
  baseline_escalation_rate_pct numeric(5,2),
  baseline_avg_response_ms     integer,

  -- Retainer (mirrors what's in engagements but per-agent so multi-agent
  -- engagements can have independent billing — rare but supported)
  monthly_retainer_cents  integer default 0,
  retainer_active         boolean default false,
  retainer_activated_at   timestamptz,
  retainer_cancelled_at   timestamptz,

  -- Lifecycle timestamps
  created_at              timestamptz not null default now(),
  shadow_mode_started_at  timestamptz,
  uat_started_at          timestamptz,
  live_started_at         timestamptz,
  archived_at             timestamptz,

  notes                   text
);

-- Indexes
create index if not exists idx_client_agents_engagement   on client_agents (engagement_id);
create index if not exists idx_client_agents_status       on client_agents (status);
create index if not exists idx_client_agents_workspace    on client_agents (workspace_id);
create index if not exists idx_client_agents_retainer_active on client_agents (retainer_active)
  where retainer_active = true;

alter table client_agents enable row level security;

comment on table client_agents is 'Agents deployed for paying clients. Distinct from ws_chat_loucel_landing (Loucel own marketing chat). Each row has a unique workspace_id that links to the audit chain — audit rows for this agent conversations carry workspace_id matching client_agents.workspace_id.';
