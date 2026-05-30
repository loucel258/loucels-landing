-- =============================================================================
-- Loucel Labs Trust Stack — Workspace Isolation (005)
-- =============================================================================
-- Closes the multi-tenant boundary on the existing tables.
--
-- Before this migration: audit_logs.workspace_id and pending_approvals.workspace_id
-- existed but were free-text with no enforcement. A bug in app code could have
-- written rows to the wrong workspace and nothing would have caught it.
--
-- After this migration:
--   1. workspace_id columns reference public.clients(workspace_id) (FK)
--   2. Tenant-scoped RLS policies require authenticated callers to provide a
--      JWT whose `workspace_id` claim matches the row's workspace_id
--   3. service_role bypass remains for admin/runtime writers
--
-- The masked demo views remain accessible to anon for the in-house demos at
-- /demo/audit and /demo/hitl. Those views are SECURITY DEFINER, meaning they
-- intentionally bypass RLS — the controlled-exposure pattern. When the demos
-- are gated behind auth (post-launch), the views are tightened to require
-- workspace match.
--
-- Run AFTER 004_clients_and_vault.sql.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Seed the demo tenant so existing demo rows satisfy the upcoming FK.
-- -----------------------------------------------------------------------------
insert into public.clients (workspace_id, name, industry, status)
values
  ('ws_demo_001',       'Loucel Internal Demo',     'demo', 'active'),
  ('ws_acme_paint_fl',  'Acme Painting (sample)',   'construction', 'active'),
  ('ws_diana_logistics','Diana Logistics (sample)', 'logistics',    'active')
on conflict (workspace_id) do nothing;

-- -----------------------------------------------------------------------------
-- Attach FKs to existing tenant-scoped tables. We add them deferrable so a
-- single transaction can insert client + dependent rows in any order.
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from information_schema.table_constraints
    where constraint_name = 'audit_logs_workspace_fk'
      and table_name = 'audit_logs'
  ) then
    alter table public.audit_logs
      add constraint audit_logs_workspace_fk
      foreign key (workspace_id) references public.clients(workspace_id)
      deferrable initially deferred;
  end if;
end$$;

do $$
begin
  if not exists (
    select 1 from information_schema.table_constraints
    where constraint_name = 'pending_approvals_workspace_fk'
      and table_name = 'pending_approvals'
  ) then
    alter table public.pending_approvals
      add constraint pending_approvals_workspace_fk
      foreign key (workspace_id) references public.clients(workspace_id)
      deferrable initially deferred;
  end if;
end$$;

-- -----------------------------------------------------------------------------
-- Helper to read workspace_id from the JWT. Returns null if no claim.
-- Inlined into policies for performance (no function call overhead at scale).
-- -----------------------------------------------------------------------------
create or replace function public.current_workspace_id()
returns text
language sql
stable
as $$
  select coalesce(
    current_setting('request.jwt.claims', true)::json->>'workspace_id',
    null
  );
$$;

revoke all on function public.current_workspace_id() from public;
grant execute on function public.current_workspace_id() to anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- RLS policies on audit_logs.
--
-- service_role bypasses by default. authenticated callers can SELECT rows of
-- their own workspace only. INSERT/UPDATE/DELETE for authenticated are denied
-- (writes go through service_role from server-side trusted code).
-- -----------------------------------------------------------------------------
drop policy if exists "tenant_select_audit_logs" on public.audit_logs;
create policy "tenant_select_audit_logs"
  on public.audit_logs
  for select
  to authenticated
  using (workspace_id = public.current_workspace_id());

-- Explicit deny for INSERT/UPDATE/DELETE from authenticated context.
-- (No policy = denied by default with RLS enabled, but stating it makes the
--  intent obvious during security review.)
-- audit_logs already blocks UPDATE/DELETE at the trigger level too.

-- -----------------------------------------------------------------------------
-- RLS policies on pending_approvals.
--
-- service_role bypasses. authenticated callers (supervisors) can SELECT and
-- UPDATE rows in their own workspace only. INSERT/DELETE goes through
-- service_role from agent and admin paths.
-- -----------------------------------------------------------------------------
drop policy if exists "tenant_select_pending_approvals" on public.pending_approvals;
create policy "tenant_select_pending_approvals"
  on public.pending_approvals
  for select
  to authenticated
  using (workspace_id = public.current_workspace_id());

drop policy if exists "tenant_update_pending_approvals" on public.pending_approvals;
create policy "tenant_update_pending_approvals"
  on public.pending_approvals
  for update
  to authenticated
  using (workspace_id = public.current_workspace_id())
  with check (workspace_id = public.current_workspace_id());

-- The previous "demo: anon can read queue" policy on pending_approvals stays;
-- it lets the in-house /demo/hitl page work without auth. When the demo is
-- gated behind a real supervisor login, drop that anon policy.
