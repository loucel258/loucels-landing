-- 028_webhook_seen.sql
-- Replay protection for inbound webhooks (F5 from the pre-launch audit).
-- Stripe gets timestamp-tolerance verification inline; Cal/DocuSign/Tally
-- don't expose a usable timestamp in their signature, so we dedupe by
-- the event id they include in the payload.

create table if not exists public.webhook_seen (
  source       text        not null check (source in ('cal', 'docusign', 'tally', 'stripe')),
  event_id     text        not null,
  received_at  timestamptz not null default now(),
  primary key (source, event_id)
);

create index if not exists webhook_seen_received_at_idx
  on public.webhook_seen (received_at desc);

alter table public.webhook_seen enable row level security;

comment on table public.webhook_seen is
  'Dedup ledger for inbound webhooks. Reject a (source, event_id) pair we have already accepted. Service-role only; no policies.';
