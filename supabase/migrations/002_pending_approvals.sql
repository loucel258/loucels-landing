-- =============================================================================
-- Loucel Labs Trust Stack — Human-in-the-Loop (Hito 4)
-- =============================================================================
-- The agent never executes high-risk actions directly. It writes a proposal
-- into `pending_approvals`; a human supervisor reviews, optionally edits the
-- text, and decides Approve / Reject. Only on Approve is the action allowed
-- to materialize (sent email, issued refund, posted reply, etc.).
--
-- Unlike audit_logs, this table IS mutable (status transitions pending →
-- approved | rejected, edited_text can be overwritten). The integrity layer
-- here is the audit_logs entry written on EVERY decide event — that record
-- stays append-only.
--
-- To apply: paste this file into the Supabase SQL editor and run.
-- =============================================================================

create extension if not exists "pgcrypto";

-- -----------------------------------------------------------------------------
-- Table
-- -----------------------------------------------------------------------------
create table if not exists public.pending_approvals (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  decided_at      timestamptz,
  workspace_id    text not null,
  -- Who/what proposed this. In production, agent_id and a model_version.
  proposer_id     text not null,
  proposer_type   text not null,           -- 'agent' | 'human'
  -- What kind of action waits for approval
  action_type     text not null,           -- 'send_quote' | 'send_refund' | 'reply_review' | 'send_message'
  recipient       text,                    -- email / phone / channel target
  -- The agent's original draft (immutable after creation)
  proposed_text   text not null,
  -- The text the supervisor will actually send (edits land here)
  edited_text     text,
  -- Status workflow
  status          text not null default 'pending'
                    check (status in ('pending', 'approved', 'rejected')),
  decider_id      text,
  decision_reason text,
  -- Risk hint surfaced from the original classifier
  risk_score      int,
  risk_flags      text[] not null default '{}',
  -- Optional FK to the audit_logs entry recorded when decision was made
  audit_log_id    uuid
);

create index if not exists pending_approvals_status_idx
  on public.pending_approvals (status, created_at desc);
create index if not exists pending_approvals_workspace_idx
  on public.pending_approvals (workspace_id, created_at desc);

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------
alter table public.pending_approvals enable row level security;

-- service_role bypasses RLS (Supabase default). For the demo UI we need anon
-- to read the queue (it's a fake supervisor inbox, not real PII). In
-- production this opens up to authenticated supervisors via JWT claims, not
-- anon.
create policy "demo: anon can read queue"
  on public.pending_approvals
  for select
  to anon, authenticated
  using (true);

-- -----------------------------------------------------------------------------
-- Grant service_role full access
-- -----------------------------------------------------------------------------
grant all on public.pending_approvals to service_role;
grant select on public.pending_approvals to anon, authenticated;

-- -----------------------------------------------------------------------------
-- Helper: bump `decided_at` automatically when status leaves pending
-- -----------------------------------------------------------------------------
create or replace function public.stamp_pending_approvals_decision()
returns trigger
language plpgsql
as $$
begin
  if new.status in ('approved', 'rejected') and old.status = 'pending' then
    new.decided_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists pending_approvals_stamp on public.pending_approvals;
create trigger pending_approvals_stamp
  before update on public.pending_approvals
  for each row execute function public.stamp_pending_approvals_decision();
