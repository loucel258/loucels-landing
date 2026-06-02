-- =============================================================================
-- 020_demo_view_grants_chat_role.sql
-- =============================================================================
-- Fixes two things from migrations 018+019:
--
-- 1. Migration 018 dropped + recreated `audit_logs_demo_view` to scope it to
--    ws_demo_001. CREATE VIEW does NOT carry over grants from the dropped
--    view, so the anon role lost SELECT access. The public /demo/audit page
--    then fails with: "permission denied for view audit_logs_demo_view".
--
-- 2. Chat audit writes need a `role` value that the chain RPC accepts. We
--    use 'visitor' and 'front_desk_agent'. Neither is on the workspace_roles
--    seeded table for ws_chat_loucel_landing, but write_audit_entry does NOT
--    validate role against workspace_roles (verified in migration 008). This
--    migration just records the role names we use so future joins / display
--    surfaces have them.
-- =============================================================================

-- 1) Restore the anon read access that 018 inadvertently dropped.
grant select on public.audit_logs_demo_view to anon, authenticated;

-- 2) Seed chat workspace roles so a future workspace_role_exists check (if
--    any route adopts it) returns true for our writes.
insert into public.workspace_roles (workspace_id, role_label, display_name)
values
  ('ws_chat_loucel_landing', 'visitor',          'Visitor'),
  ('ws_chat_loucel_landing', 'front_desk_agent', 'Front Desk Agent')
on conflict do nothing;
