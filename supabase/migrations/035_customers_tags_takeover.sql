-- 035_customers_tags_takeover.sql
-- Three additions to support the portal v2 upgrade:
--   1. customers: deduplicated end-user records per engagement
--   2. conversation_tags: client-managed labels for sessions
--   3. paused_sessions: owner take-over flag so the agent stands down
-- Plus preferred_language on client_portal_access for the EN/ES toggle.

-- =====================================================================
-- 1. customers
-- =====================================================================
create table if not exists public.customers (
  id              uuid primary key default gen_random_uuid(),
  engagement_id   uuid not null references public.engagements(id) on delete cascade,
  email           text not null,
  display_name    text,
  first_seen_at   timestamptz not null default now(),
  last_seen_at    timestamptz not null default now(),
  total_sessions  int not null default 0,
  total_bookings  int not null default 0,
  metadata        jsonb not null default '{}'::jsonb,
  notes           text,
  unique (engagement_id, email)
);

create index if not exists customers_engagement_idx
  on public.customers (engagement_id, last_seen_at desc);

alter table public.customers enable row level security;
grant insert, select, update, delete on table public.customers to service_role;

-- Add customer_id back-references so we can correlate
alter table public.leads
  add column if not exists customer_id uuid references public.customers(id) on delete set null;

alter table public.conversation_messages
  add column if not exists customer_id uuid references public.customers(id) on delete set null;

create index if not exists leads_customer_idx
  on public.leads (customer_id) where customer_id is not null;
create index if not exists conversation_messages_customer_idx
  on public.conversation_messages (customer_id) where customer_id is not null;

comment on table public.customers is
  'Deduplicated end-user records per engagement. Email is the natural key; identity stitched lazily as conversations + leads come in.';

-- =====================================================================
-- 2. conversation_tags
-- =====================================================================
create table if not exists public.conversation_tags (
  id              uuid primary key default gen_random_uuid(),
  engagement_id   uuid not null references public.engagements(id) on delete cascade,
  session_id      text not null,
  tag             text not null check (tag in (
                    'complaint',
                    'booking',
                    'info_request',
                    'follow_up',
                    'spam',
                    'vip',
                    'urgent',
                    'sale_lost',
                    'sale_won'
                  )),
  applied_by      text not null,                -- 'portal:slug' | 'admin:steven' | 'auto:agent'
  created_at      timestamptz not null default now(),
  unique (engagement_id, session_id, tag)
);

create index if not exists conversation_tags_session_idx
  on public.conversation_tags (session_id);
create index if not exists conversation_tags_engagement_idx
  on public.conversation_tags (engagement_id, created_at desc);

alter table public.conversation_tags enable row level security;
grant insert, select, delete on table public.conversation_tags to service_role;

comment on table public.conversation_tags is
  'Client-managed labels for sessions. Used to filter Bandeja and roll up Analytics topic distribution.';

-- =====================================================================
-- 3. paused_sessions (take-over)
-- =====================================================================
create table if not exists public.paused_sessions (
  session_id      text primary key,
  engagement_id   uuid not null references public.engagements(id) on delete cascade,
  paused_at       timestamptz not null default now(),
  paused_by       text not null,                -- 'portal:slug'
  paused_until    timestamptz,                  -- null = indefinite
  reason          text
);

create index if not exists paused_sessions_engagement_idx
  on public.paused_sessions (engagement_id, paused_at desc);

alter table public.paused_sessions enable row level security;
grant insert, select, update, delete on table public.paused_sessions to service_role;

comment on table public.paused_sessions is
  'Sessions where the owner has taken over the conversation. The chat agent must check this table before responding and stand down if a row exists for the session.';

-- =====================================================================
-- 4. preferred_language on client_portal_access
-- =====================================================================
alter table public.client_portal_access
  add column if not exists preferred_language text check (preferred_language in ('en', 'es'));

comment on column public.client_portal_access.preferred_language is
  'Per-client portal language override. Null = inherit from engagement.language. en = English default.';
