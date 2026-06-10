-- 043_dashboard_read_rls_policies.sql
-- Close the loose end from the F11 hardening: loucels_dashboard_read got
-- table GRANTs (029) but the tables have RLS enabled with NO policy for
-- the role — so every admin-dashboard read returned zero rows silently
-- (surfaced 2026-06-10: /admin/agents showed an empty fleet while two
-- agents existed).
--
-- The role is a READ-ONLY internal dashboard identity minted per-request
-- by the admin server. A permissive FOR SELECT policy on each table it
-- can read is the intended design. Loop handles tables that may not
-- exist in a given environment and is idempotent.

do $$
declare
  t text;
  tables text[] := array[
    'leads',
    'engagements',
    'subscribers',
    'client_agents',
    'audit_logs',
    'alerts_sent',
    'ops_notifications',
    'webhook_seen',
    'client_portal_access',
    'client_incidents',
    'conversation_review_tags',
    'conversation_messages',
    'customers',
    'conversation_tags',
    'paused_sessions',
    'agent_usage_monthly',
    'audit_chain_head'
  ];
begin
  foreach t in array tables loop
    if to_regclass('public.' || t) is not null then
      execute format('grant select on table public.%I to loucels_dashboard_read', t);
      execute format('drop policy if exists dashboard_read_select on public.%I', t);
      execute format(
        'create policy dashboard_read_select on public.%I for select to loucels_dashboard_read using (true)',
        t
      );
    end if;
  end loop;
end $$;
