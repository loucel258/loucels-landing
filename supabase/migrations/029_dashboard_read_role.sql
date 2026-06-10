-- 029_dashboard_read_role.sql
-- Defense-in-depth (F11). Create a Postgres role with SELECT-only access
-- to the tables the admin dashboard reads. The app currently uses the
-- service-role key for everything; the goal of this migration is to make
-- a read-only role available so we can swap admin read paths over to it
-- in a follow-up PR without changing schema again.
--
-- Service-role for writes (webhooks, chat audit, lead insert) stays as is.
-- The dashboard reads (leads list, engagement detail, audit_logs)
-- eventually point at `loucels_dashboard_read` via a separate Supabase
-- connection. This migration only provisions the role + grants — wiring
-- it into the app is a code change without a schema change.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'loucels_dashboard_read') then
    create role loucels_dashboard_read nologin;
  end if;
end$$;

grant usage on schema public to loucels_dashboard_read;

grant select on table public.leads             to loucels_dashboard_read;
grant select on table public.engagements       to loucels_dashboard_read;
grant select on table public.subscribers       to loucels_dashboard_read;
grant select on table public.client_agents     to loucels_dashboard_read;
grant select on table public.audit_logs        to loucels_dashboard_read;
grant select on table public.alerts_sent       to loucels_dashboard_read;

-- Future tables in public should NOT inherit access by default. We do
-- not run ALTER DEFAULT PRIVILEGES; the role is explicit on purpose.

comment on role loucels_dashboard_read is
  'Read-only role for the admin dashboard. Swap admin read paths to this role to cut the blast radius of a service-role key leak.';
