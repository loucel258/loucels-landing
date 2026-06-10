-- 039_multi_tenant_table_grants.sql
-- Sweep grants for every table the multi-tenant chat path touches. Same
-- root cause as 032 and 037: enabling RLS without granting service_role
-- causes silent permission_denied errors. Doing all tables in one shot
-- so the agent end-to-end (resolve → audit → persist lead → persist
-- transcript → tag/take-over) stops tripping over this.

grant insert, select, update, delete on public.leads                   to service_role;
grant insert, select, update, delete on public.paused_sessions         to service_role;
grant insert, select, update, delete on public.conversation_messages   to service_role;
grant insert, select, update, delete on public.conversation_tags       to service_role;
grant insert, select, update, delete on public.customers               to service_role;
