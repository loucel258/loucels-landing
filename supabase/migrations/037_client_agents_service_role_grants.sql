-- 037_client_agents_service_role_grants.sql
-- Same root cause as 032: migration 024 enabled RLS on client_agents but
-- never granted service_role on the table. The agent resolver runs under
-- service_role, so its SELECT returns empty silently — the widget got 404
-- on /widget-config even though the row existed. Service role bypasses
-- RLS but still needs the GRANT.
--
-- Same fix applied to other tables introduced alongside client_agents
-- (leads has its own grants from earlier; double-check related multi-
-- tenant tables here so we don't trip over this again).

grant insert, select, update, delete on public.client_agents to service_role;
