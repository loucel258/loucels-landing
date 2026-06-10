-- ===================================================================
-- 022_engagements.sql — Engagement lifecycle tracking
-- ===================================================================
-- Problem (per workflow-architect GAP-D1, GAP-D3, GAP-D5):
--   DocuSign + Stripe + Tally events all flow into Steven's inbox and
--   he correlates them eyeball-by-eyeball. At 3+ concurrent audits this
--   produces dropped balls (kickoff scheduled before payment cleared,
--   payment cleared without signed SOW, intake form responses orphaned).
--
-- Solution:
--   An `engagements` table that's the single source of truth for the
--   sales pipeline. Webhooks from DocuSign + Stripe + Tally write to it.
--   The /admin/chat-pulse dashboard reads from it to show "where is each
--   active engagement RIGHT NOW."
--
-- Linkage:
--   - `lead_id` foreign key to the leads table (one lead → one engagement
--     if it converts; not all leads become engagements)
--   - `engagement_ref` mirrors the bash scaffold's OGA-YYYYMMDD-XXXX
--     format so the dashboard, file system, and DB use the same id
--
-- Status transitions (the only valid paths):
--   prospect_signed_up
--     ↓ DocuSign webhook (envelope_completed)
--   sow_signed
--     ↓ Stripe webhook (payment_succeeded)
--   paid
--     ↓ manual or Tally webhook
--   intake_received
--     ↓ manual (Steven schedules kickoff)
--   kickoff_scheduled
--     ↓ manual (Steven holds kickoff)
--   in_progress
--     ↓ manual (Steven delivers Gap Map)
--   delivered
--     ↓ within 30 days
--   converted_to_build | declined | abandoned
--
--   Plus terminal failure states from anywhere:
--   sow_voided (DocuSign declined/voided)
--   payment_failed (Stripe payment failed)
-- ===================================================================

create table if not exists engagements (
  id                       uuid primary key default gen_random_uuid(),

  -- Reference id used everywhere (file folders, SOW envelope name, etc.)
  engagement_ref           text not null unique,             -- OGA-YYYYMMDD-XXXX

  -- Linkage to source lead (nullable: some engagements may start
  -- without a chat-originated lead — e.g., direct referral)
  lead_id                  uuid references leads(id),

  -- Client identity (denormalized so engagement is queryable standalone)
  client_legal_name        text not null,
  client_email             text not null,
  vertical                 text,                              -- 'roofing' | 'medspa' | ...
  language                 text not null default 'en' check (language in ('en', 'es')),

  -- Engagement type
  engagement_type          text not null default 'gap_audit'
                             check (engagement_type in (
                               'gap_audit',
                               'smv_build',
                               'integration_control'
                             )),

  -- Status lifecycle
  status                   text not null default 'prospect_signed_up'
                             check (status in (
                               'prospect_signed_up',  -- SOW sent, not yet signed
                               'sow_signed',           -- DocuSign envelope completed
                               'paid',                 -- Stripe payment cleared
                               'intake_received',      -- Tally form submitted
                               'kickoff_scheduled',    -- Manually marked by Steven
                               'in_progress',          -- Audit work happening (days 2-6)
                               'delivered',            -- Gap Map + Risk Snapshot sent
                               'converted_to_build',   -- Client signed build SOW
                               'declined',             -- Client said no after walkthrough
                               'abandoned',            -- No response after day-28 follow-up
                               'sow_voided',           -- DocuSign envelope declined/voided
                               'payment_failed'        -- Stripe payment failed
                             )),

  -- Financial
  audit_fee_cents          integer not null default 50000,    -- $500.00
  stripe_payment_intent_id text,
  stripe_paid_at           timestamptz,
  stripe_amount_paid_cents integer,

  -- DocuSign
  docusign_envelope_id     text,
  docusign_sent_at         timestamptz,
  docusign_signed_at       timestamptz,
  docusign_voided_at       timestamptz,

  -- Intake
  tally_submission_id      text,
  intake_received_at       timestamptz,

  -- Lifecycle timestamps
  created_at               timestamptz not null default now(),
  kickoff_at               timestamptz,                       -- when Steven schedules
  delivered_at             timestamptz,                       -- when Gap Map sent
  walkthrough_at           timestamptz,                       -- when walkthrough completed
  outcome_at               timestamptz,                       -- when status hit terminal

  -- Steven's notes (free text — internal only, never client-facing)
  notes                    text,

  -- Audit fee credit tracking for build conversion (Option C: 50%)
  credit_amount_cents      integer not null default 25000,    -- $250
  credit_applied_to_build_ref text,                            -- BLD-YYYYMMDD-XXXX when converted
  credit_expires_at        timestamptz                         -- delivered_at + 30 days
);

-- Indexes
create index if not exists idx_engagements_status        on engagements (status);
create index if not exists idx_engagements_created       on engagements (created_at desc);
create index if not exists idx_engagements_client_email  on engagements (lower(client_email));
create index if not exists idx_engagements_lead          on engagements (lead_id);
create unique index if not exists ux_engagements_docusign on engagements (docusign_envelope_id)
  where docusign_envelope_id is not null;
create unique index if not exists ux_engagements_stripe  on engagements (stripe_payment_intent_id)
  where stripe_payment_intent_id is not null;

-- RLS — service-role only
alter table engagements enable row level security;

-- Comment
comment on table engagements is 'Single source of truth for sales pipeline. Populated by DocuSign + Stripe + Tally webhooks, plus manual updates from Steven. Replaces the eyeball-correlation across 3 dashboards.';
