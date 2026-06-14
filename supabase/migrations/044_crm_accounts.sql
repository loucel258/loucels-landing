-- 044_crm_accounts.sql
-- CRM layer for /admin. Adds an ACCOUNT entity above engagements so one
-- client (company) can hold many engagements + agents over time — the
-- land-and-expand shape (Gap Audit → build → 2nd agent). Engagements,
-- client_agents, leads, agent_usage_monthly stay the source of truth for
-- deal state and metrics; this migration only adds the relationship layer:
--
--   crm_accounts  — the company/account (contact + lifecycle)
--   engagements.account_id — FK so existing deals roll up to an account
--   crm_notes     — append-style activity log per account
--   crm_tasks     — follow-ups with due dates (day-14 / day-28 cadence)
--
-- Rollup metrics (hours saved, after-hours leads, MRR, churn signal) are
-- COMPUTED at read time from the existing tables — never denormalized here,
-- so they can't drift.
--
-- Writes happen via service_role from admin server actions. The read-only
-- dashboard role (loucels_dashboard_read) gets SELECT + an RLS policy, same
-- pattern as migration 043.
--
-- Idempotent. To apply: paste into the Supabase SQL editor and run.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Accounts
-- ---------------------------------------------------------------------------
create table if not exists public.crm_accounts (
  id                    uuid primary key default gen_random_uuid(),
  account_name          text not null,
  primary_contact_name  text,
  primary_contact_email text,
  primary_contact_phone text,
  vertical              text,
  language              text not null default 'en' check (language in ('en', 'es')),
  -- Where the relationship sits, independent of any single engagement's
  -- status. An account can be 'active' (paying retainer) while a new
  -- engagement inside it is still 'prospect'.
  lifecycle             text not null default 'prospect'
                          check (lifecycle in ('prospect', 'active', 'dormant', 'churned')),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
-- RLS on immediately (no anon/authenticated policy = no access for those
-- roles; service_role bypasses; the dashboard_read policy is added below).
alter table public.crm_accounts enable row level security;

create index if not exists crm_accounts_lifecycle_idx
  on public.crm_accounts (lifecycle, updated_at desc);
-- One account per real client email — used by the backfill + dedupe on create.
create unique index if not exists crm_accounts_email_uniq
  on public.crm_accounts (lower(primary_contact_email))
  where primary_contact_email is not null;

-- ---------------------------------------------------------------------------
-- Link engagements → accounts
-- ---------------------------------------------------------------------------
alter table public.engagements
  add column if not exists account_id uuid references public.crm_accounts(id) on delete set null;

create index if not exists engagements_account_idx
  on public.engagements (account_id);

-- ---------------------------------------------------------------------------
-- Notes — append-style activity log
-- ---------------------------------------------------------------------------
create table if not exists public.crm_notes (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references public.crm_accounts(id) on delete cascade,
  body        text not null,
  author      text not null default 'steven',
  created_at  timestamptz not null default now()
);
alter table public.crm_notes enable row level security;

create index if not exists crm_notes_account_idx
  on public.crm_notes (account_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Tasks / follow-ups
-- ---------------------------------------------------------------------------
create table if not exists public.crm_tasks (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references public.crm_accounts(id) on delete cascade,
  title         text not null,
  due_date      date,
  status        text not null default 'open' check (status in ('open', 'done')),
  -- 'followup_d14' / 'followup_d28' map to the conversion-playbook cadence;
  -- 'custom' is everything else.
  kind          text not null default 'custom'
                  check (kind in ('followup_d14', 'followup_d28', 'custom')),
  created_at    timestamptz not null default now(),
  completed_at  timestamptz
);
alter table public.crm_tasks enable row level security;

create index if not exists crm_tasks_open_due_idx
  on public.crm_tasks (status, due_date)
  where status = 'open';
create index if not exists crm_tasks_account_idx
  on public.crm_tasks (account_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Backfill: one account per distinct client email already in engagements.
-- Picks the most recent engagement's identity fields as the account seed.
-- Re-runnable: on conflict (email) does nothing, and only links engagements
-- whose account_id is still null.
-- ---------------------------------------------------------------------------
insert into public.crm_accounts (account_name, primary_contact_email, primary_contact_name, vertical, language, lifecycle)
select distinct on (lower(e.client_email))
  e.client_legal_name,
  e.client_email,
  e.client_legal_name,
  e.vertical,
  e.language,
  'prospect'
from public.engagements e
where e.client_email is not null
  and not exists (
    select 1 from public.crm_accounts a
    where lower(a.primary_contact_email) = lower(e.client_email)
  )
order by lower(e.client_email), e.created_at desc;

update public.engagements e
set account_id = a.id
from public.crm_accounts a
where e.account_id is null
  and lower(e.client_email) = lower(a.primary_contact_email);

-- ---------------------------------------------------------------------------
-- RLS + grants
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
  tables text[] := array['crm_accounts', 'crm_notes', 'crm_tasks'];
begin
  foreach t in array tables loop
    execute format('alter table public.%I enable row level security', t);
    -- read-only dashboard identity (admin read pages)
    execute format('grant select on table public.%I to loucels_dashboard_read', t);
    execute format('drop policy if exists dashboard_read_select on public.%I', t);
    execute format(
      'create policy dashboard_read_select on public.%I for select to loucels_dashboard_read using (true)',
      t
    );
    -- service_role bypasses RLS but still needs table-level DML grants
    -- (this project doesn't set default privileges for new public tables).
    execute format('grant select, insert, update, delete on table public.%I to service_role', t);
  end loop;
end $$;
