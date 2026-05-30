-- =============================================================================
-- 017_workspace_roles_table.sql
-- =============================================================================
-- Moves role definitions from a hardcoded TS array into a per-workspace
-- table. Today the RBAC route gates JWT claims against
-- `VALID_ROLES = ["front_desk_agent", "compliance_officer"]` hardcoded
-- in route.ts. Adding a third role for a customer requires a code deploy
-- and means EVERY tenant sees the new role, not just the one paying for
-- it.
--
-- This migration creates `public.workspace_roles` where each row binds
-- (workspace_id, role_label) and optionally a display name + a JSON
-- profile blob. The RBAC route looks up the JWT's role_label against
-- this table; if missing, 403.
--
-- The table is permissive by design — admins SELECT/INSERT via
-- service_role; the route reads via a SECURITY DEFINER helper so we
-- don't grant authenticated callers raw SELECT on a table that might
-- one day hold sensitive policy hints.
-- =============================================================================

create table if not exists public.workspace_roles (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  text not null
                  references public.clients(workspace_id) on delete cascade,
  role_label    text not null
                  check (role_label ~ '^[a-z][a-z0-9_]{2,40}$'),
  display_name  text,
  profile       jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  unique (workspace_id, role_label)
);

create index if not exists workspace_roles_ws_idx
  on public.workspace_roles (workspace_id);

alter table public.workspace_roles enable row level security;
grant all on public.workspace_roles to service_role;
revoke all on public.workspace_roles from anon, authenticated;

-- ----------------------------------------------------------------------------
-- Seed the existing two roles for ws_demo_001 so the demo keeps working
-- after the route switches to the table-backed lookup.
-- ----------------------------------------------------------------------------
insert into public.workspace_roles (workspace_id, role_label, display_name)
values
  ('ws_demo_001', 'front_desk_agent',  'Front Desk Agent'),
  ('ws_demo_001', 'compliance_officer','Compliance Officer'),
  ('ws_demo_001', 'supervisor',        'HITL Supervisor')
on conflict (workspace_id, role_label) do nothing;

-- Backfill: ensure the demo workspace has a clients row (audit data
-- predates the clients table for that workspace_id).
insert into public.clients (workspace_id, name, status)
values ('ws_demo_001', 'Loucel Labs Demo', 'active')
on conflict (workspace_id) do nothing;

-- ----------------------------------------------------------------------------
-- workspace_role_exists(workspace_id, role_label) → boolean
-- Cheap SECURITY DEFINER lookup the route uses to validate the JWT's
-- role_label without granting SELECT on the table.
-- ----------------------------------------------------------------------------
create or replace function public.workspace_role_exists(
  p_workspace_id text,
  p_role_label   text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(
    select 1 from public.workspace_roles
     where workspace_id = p_workspace_id
       and role_label   = p_role_label
  );
$$;

revoke all on function public.workspace_role_exists(text, text) from public;
grant execute on function public.workspace_role_exists(text, text) to service_role;
grant execute on function public.workspace_role_exists(text, text) to authenticated;
