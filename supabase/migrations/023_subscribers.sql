-- ===================================================================
-- 023_subscribers.sql — Soft-CTA email capture for nurture sequence
-- ===================================================================
-- Problem (per workflow-architect GAP-A3 + GAP-RE1):
--   99% of landing visitors leave without engaging the chat. Currently
--   no way to recapture them — no retargeting pixel, no email magnet.
--
-- Solution:
--   A "Send me the Trust Stack one-pager" soft-CTA captures email. The
--   subscriber is then enrolled in a 3-email nurture sequence (delivered
--   manually via Resend until automation matures).
--
-- Privacy:
--   Email only. No name, no tracking pixel, no third-party cookie.
--   Subscriber can opt out via standard unsubscribe link in every email.
-- ===================================================================

create table if not exists subscribers (
  id              uuid primary key default gen_random_uuid(),
  email           text not null,
  source          text not null default 'footer_pdf_cta',  -- where they signed up
  locale          text not null default 'en' check (locale in ('en', 'es')),
  -- Sequence state
  pdf_sent_at        timestamptz,                          -- email 1: PDF delivery
  audit_email_sent_at timestamptz,                         -- email 2: Gap Audit explainer
  call_email_sent_at  timestamptz,                         -- email 3: 15-min call invite
  -- Lifecycle
  created_at      timestamptz not null default now(),
  unsubscribed_at timestamptz,
  -- Optional fields populated if subscriber later converts to lead
  became_lead_at  timestamptz,
  became_lead_id  uuid references leads(id)
);

create unique index if not exists ux_subscribers_email_active
  on subscribers (lower(email))
  where unsubscribed_at is null;

create index if not exists idx_subscribers_created on subscribers (created_at desc);
create index if not exists idx_subscribers_sequence_progress
  on subscribers (pdf_sent_at, audit_email_sent_at, call_email_sent_at)
  where unsubscribed_at is null;

alter table subscribers enable row level security;

-- Service-role only — no public access to the subscriber list.
comment on table subscribers is 'Soft-CTA email capture for nurture sequence. Email-only collection (no other PII). Automated sends via /api/cron/nurture-sequence cron on Vercel.';
