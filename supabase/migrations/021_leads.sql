-- ===================================================================
-- 021_leads.sql — Persistent lead capture
-- ===================================================================
-- Problem (per workflow-architect report GAP-B5 + GAP-C1):
--   The chat agent gathers visitor name+email+reason via the request_booking
--   tool, forwards them to Cal.com via a deep-link URL, and persists NONE
--   of it server-side. If the visitor abandons the Cal.com booking form,
--   the lead is lost. The audit chain only stores a hash, intentionally.
--
-- Solution:
--   A `leads` table that captures the lead the moment the booking tool
--   fires, then is updated when Cal.com confirms (via webhook). This is
--   the only place where visitor PII is persisted in plaintext — by
--   commercial necessity, no other choice.
--
-- Design choices:
--   - Plaintext name + email (we need to follow up; hashes don't help).
--   - Reason stored as plaintext too — short, business context, no PII
--     beyond what visitor volunteered.
--   - session_id + audit_request_id link back to the audit chain so the
--     full conversation context is traceable from a lead row.
--   - booking_status starts at 'offered'. Cal.com webhook transitions to
--     'confirmed' (with slot details) OR remains 'offered' (visible
--     abandoned-funnel signal).
--   - RLS locks reads to service-role only. No anon/public access ever.
--   - INSERT-only by service-role; UPDATE allowed by service-role for
--     webhook-driven status transitions. No DELETE policy — leads are
--     retained per Loucel's own data retention policy (see GAP-D12 todo).
-- ===================================================================

create table if not exists leads (
  id                   uuid primary key default gen_random_uuid(),
  -- Linkage back to the chat session that generated this lead
  session_id           text not null,
  audit_request_id     uuid,
  -- Lead identity (the part hashes can't replace)
  name                 text not null,
  email                text not null,
  reason               text not null,
  preferred_window     text,
  -- Booking lifecycle
  booking_status       text not null default 'offered'
                         check (booking_status in (
                           'offered',        -- chat sent the link, awaiting Cal.com action
                           'confirmed',      -- Cal.com webhook fired BOOKING_CREATED
                           'rescheduled',    -- Cal.com webhook fired BOOKING_RESCHEDULED
                           'cancelled',      -- Cal.com webhook fired BOOKING_CANCELLED
                           'abandoned'       -- manual flag (no webhook after N days)
                         )),
  booking_link         text not null,                  -- the exact URL the agent sent
  booking_slot_iso     timestamptz,                    -- populated from Cal.com webhook
  cal_event_id         text,                           -- Cal.com's internal event identifier
  -- Lifecycle timestamps
  created_at           timestamptz not null default now(),
  confirmed_at         timestamptz,
  -- Source attribution (for future channel diversification)
  source               text not null default 'chat_widget',  -- 'chat_widget' | 'footer_cta' | 'template_card' etc.
  ip_address           inet,
  -- Operator-facing notes
  notes                text,
  followed_up_at       timestamptz                     -- nulled until Steven marks
);

-- Indexes for common queries
create index if not exists idx_leads_created_at on leads (created_at desc);
create index if not exists idx_leads_status     on leads (booking_status);
create index if not exists idx_leads_email      on leads (lower(email));
create index if not exists idx_leads_session    on leads (session_id);

-- RLS — locked down completely. Service-role only.
alter table leads enable row level security;

-- No policies = effectively no access from any non-service role.
-- Service-role bypasses RLS by design (postgres GRANT model).

-- Comment for future maintainers
comment on table leads is 'Persistent lead capture from chat agent. PII (name+email) lives here because follow-up requires it; nowhere else in the schema stores visitor PII as plaintext. Retention policy enforced via Mac-local launchd cron (see gap-audit-kit/security/).';
