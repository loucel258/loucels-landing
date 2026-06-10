-- 031_workspace_and_portal.sql
-- Foundation for the Engagement Workspace hub + Client Portal v1.
--
-- Three new tables, all multi-tenant via client_slug + engagement_id:
--
--   client_portal_access  — passcode-based auth for the client-facing portal
--   client_incidents      — per-engagement incident log + postmortems
--   conversation_review_tags — internal QC tags applied to chat sessions
--
-- All RLS-enabled. Service-role used by webhooks/writers; the dashboard
-- read role gets SELECT via the existing GRANT in migration 029 (extended
-- here for the new tables).

-- =====================================================================
-- client_portal_access
-- =====================================================================
create table if not exists public.client_portal_access (
  id              uuid primary key default gen_random_uuid(),
  engagement_id   uuid not null references public.engagements(id) on delete cascade,
  client_slug     text not null,                          -- URL slug, e.g. "acme-medspa"
  passcode_hash   text not null,                          -- scrypt-derived, 64 hex chars
  passcode_salt   text not null,                          -- 32 hex chars
  display_name    text not null,                          -- shown in portal header
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  revoked_at      timestamptz,
  last_login_at   timestamptz,
  login_count     int not null default 0,
  unique (client_slug)
);

create index if not exists client_portal_access_engagement_idx
  on public.client_portal_access (engagement_id);

alter table public.client_portal_access enable row level security;

comment on table public.client_portal_access is
  'Per-client portal auth. The portal at /portal/[clientSlug] verifies passcode against this row, then sets a signed cookie scoped to client_slug.';

-- =====================================================================
-- client_incidents
-- =====================================================================
create table if not exists public.client_incidents (
  id              uuid primary key default gen_random_uuid(),
  engagement_id   uuid not null references public.engagements(id) on delete cascade,
  client_slug     text not null,
  created_at      timestamptz not null default now(),
  resolved_at     timestamptz,
  severity        text not null check (severity in ('low', 'medium', 'high', 'critical')),
  title           text not null,
  summary         text not null,
  postmortem      text,                                   -- markdown, written after resolution
  visible_to_client boolean not null default false,       -- toggle for portal display
  detected_via    text,                                   -- 'cron_alert' | 'manual' | 'client_reported'
  source_audit_id uuid                                    -- optional FK to audit_logs row
);

create index if not exists client_incidents_engagement_idx
  on public.client_incidents (engagement_id, created_at desc);
create index if not exists client_incidents_unresolved_idx
  on public.client_incidents (engagement_id) where resolved_at is null;

alter table public.client_incidents enable row level security;

comment on table public.client_incidents is
  'Per-engagement incident log. visible_to_client controls whether the client portal shows the incident; postmortem is markdown for the writeup.';

-- =====================================================================
-- conversation_review_tags
-- =====================================================================
create table if not exists public.conversation_review_tags (
  id              uuid primary key default gen_random_uuid(),
  engagement_id   uuid references public.engagements(id) on delete set null,
  client_slug     text,                                   -- nullable for the loucels-own chat
  session_id      text not null,                          -- chat session being tagged
  tag             text not null check (tag in (
                    'good_resolution',
                    'wrong_escalation',
                    'missed_escalation',
                    'hallucination',
                    'great_save',
                    'needs_kb_update',
                    'client_complained'
                  )),
  reviewer_note   text,
  reviewed_by     text not null,                          -- 'steven' or future teammates
  created_at      timestamptz not null default now(),
  unique (session_id, tag, reviewed_by)
);

create index if not exists conversation_review_tags_engagement_idx
  on public.conversation_review_tags (engagement_id, created_at desc);
create index if not exists conversation_review_tags_session_idx
  on public.conversation_review_tags (session_id);

alter table public.conversation_review_tags enable row level security;

comment on table public.conversation_review_tags is
  'Manual review tags applied to chat sessions. Feeds the QA loop and eventually the eval suite (good_resolution -> positive examples, missed_escalation -> regression tests).';

-- =====================================================================
-- Grant SELECT to read-only dashboard role (F11 wiring)
-- =====================================================================
grant select on table public.client_portal_access     to loucels_dashboard_read;
grant select on table public.client_incidents         to loucels_dashboard_read;
grant select on table public.conversation_review_tags to loucels_dashboard_read;
