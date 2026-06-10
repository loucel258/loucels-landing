-- 032_workspace_portal_service_role_grants.sql
-- Supabase doesn't auto-grant service_role on tables created via raw SQL
-- migrations when RLS is enabled. Migration 031 missed these, surfacing
-- as "permission denied for table" on the admin portal-access endpoint.
-- Service role bypasses RLS but still needs table-level GRANTs.

grant insert, select, update, delete on public.client_portal_access      to service_role;
grant insert, select, update, delete on public.client_incidents          to service_role;
grant insert, select, update, delete on public.conversation_review_tags  to service_role;
