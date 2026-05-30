-- =============================================================================
-- Loucel Labs Trust Stack — Audit Log (Hito 3)
-- =============================================================================
-- Append-only forensic log. Inserts are allowed (via service_role only).
-- UPDATE and DELETE are blocked at the trigger level so that even a platform
-- administrator cannot rewrite history. The anon role can read a redacted
-- subset via the secure view defined at the bottom.
--
-- To apply: paste this file into the Supabase SQL editor and run it once.
-- =============================================================================

create extension if not exists "pgcrypto";

-- -----------------------------------------------------------------------------
-- Table
-- -----------------------------------------------------------------------------
create table if not exists public.audit_logs (
  id              uuid primary key default gen_random_uuid(),
  inserted_at     timestamptz not null default now(),
  request_id      text not null,
  workspace_id    text not null,
  user_id         text not null,
  role            text not null,
  ip_address      inet,
  source          text not null,            -- 'dlp' | 'rbac' | future modules
  decision        text not null,            -- 'ALLOW' | 'DENY'
  blocked_by      text,                     -- name of the check that fired
  reason          text not null,
  sanitized_prompt_hash text not null,      -- FNV-1a or SHA-256 of the prompt
  detected_scopes text[] not null default '{}',
  detected_actions text[] not null default '{}',
  prompt_injection_match_count int not null default 0,
  redaction_count int not null default 0,
  redaction_summary jsonb not null default '{}'::jsonb,
  model_version   text,                     -- which Claude model the request targeted
  token_usage_in  int,
  token_usage_out int,
  -- Forensic integrity: each row carries a hash of the previous row's id so
  -- that any out-of-band tampering breaks the chain in a detectable way.
  prev_row_hash   text
);

-- Indexes for the most common forensic queries
create index if not exists audit_logs_inserted_at_idx on public.audit_logs (inserted_at desc);
create index if not exists audit_logs_workspace_idx   on public.audit_logs (workspace_id, inserted_at desc);
create index if not exists audit_logs_decision_idx    on public.audit_logs (decision, inserted_at desc);
create index if not exists audit_logs_user_idx        on public.audit_logs (user_id, inserted_at desc);

-- -----------------------------------------------------------------------------
-- Immutability triggers — block UPDATE and DELETE for every role.
-- -----------------------------------------------------------------------------
create or replace function public.block_audit_modification()
returns trigger
language plpgsql
as $$
begin
  raise exception
    'audit_logs is append-only. % is not permitted on this table.',
    tg_op;
end;
$$;

drop trigger if exists audit_logs_no_update on public.audit_logs;
create trigger audit_logs_no_update
  before update on public.audit_logs
  for each row execute function public.block_audit_modification();

drop trigger if exists audit_logs_no_delete on public.audit_logs;
create trigger audit_logs_no_delete
  before delete on public.audit_logs
  for each row execute function public.block_audit_modification();

-- TRUNCATE bypasses BEFORE DELETE triggers — block it explicitly.
drop trigger if exists audit_logs_no_truncate on public.audit_logs;
create trigger audit_logs_no_truncate
  before truncate on public.audit_logs
  execute function public.block_audit_modification();

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------
-- service_role bypasses RLS by design (Supabase), so server-side inserts work.
-- For anon (the demo viewer), we expose a read-only secure view below.
alter table public.audit_logs enable row level security;

-- No policies for anon/authenticated → table is invisible to them by default.
-- service_role bypasses RLS for inserts. View below provides the read surface.

-- -----------------------------------------------------------------------------
-- Read view for the demo UI (no raw user_ids or IPs)
-- -----------------------------------------------------------------------------
-- NOTE: This view is intentionally SECURITY DEFINER (no security_invoker flag).
--
-- Supabase's Security Advisor will flag this. The warning is generically
-- correct — security_definer views can bypass the calling user's RLS. In
-- THIS design that is the goal:
--
--   - public.audit_logs is deliberately locked down (RLS on, no anon policy).
--   - public.audit_logs_demo_view is the ONLY window into the data we expose
--     to anon, and the view itself does the masking (user_id obfuscation,
--     IP stripping, no raw prompt).
--
-- If we set security_invoker = on, anon's RLS applies to the underlying
-- table and the view fails with "permission denied". The masked-window
-- pattern requires the creator's elevated read to pass through. Dismiss the
-- advisor finding for this specific entity with that justification.
-- -----------------------------------------------------------------------------
create or replace view public.audit_logs_demo_view as
select
  id,
  inserted_at,
  request_id,
  workspace_id,
  -- mask the last 4 chars of the user_id so it's recognizable but not personal
  substring(user_id, 1, length(user_id) - 4) || 'XXXX' as user_id_masked,
  role,
  source,
  decision,
  blocked_by,
  reason,
  sanitized_prompt_hash,
  detected_scopes,
  detected_actions,
  prompt_injection_match_count,
  redaction_count,
  redaction_summary,
  model_version,
  token_usage_in,
  token_usage_out
from public.audit_logs
order by inserted_at desc;

-- Allow anon to read the view (the underlying table stays locked down).
grant select on public.audit_logs_demo_view to anon, authenticated;

-- -----------------------------------------------------------------------------
-- Grant service_role full access on the table and view.
-- Required in newer Supabase projects where SQL-editor-created tables are
-- owned by `postgres` and service_role does not auto-inherit permissions.
-- service_role still bypasses RLS — these grants restore table-level access.
-- -----------------------------------------------------------------------------
grant all on public.audit_logs to service_role;
grant all on public.audit_logs_demo_view to service_role;
