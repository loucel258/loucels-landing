-- 030_dashboard_read_grant_authenticator.sql
-- PostgREST (Supabase's API layer) authenticates as the `authenticator`
-- role, then SET ROLE to whatever the JWT's `role` claim says. For the
-- dashboard to use loucels_dashboard_read via a custom JWT, authenticator
-- must be a member of it. Otherwise PostgREST returns:
--   "JWSError JWSInvalidSignature" or "role not allowed".
--
-- Idempotent: GRANT TO is a no-op if already granted.

grant loucels_dashboard_read to authenticator;

comment on role loucels_dashboard_read is
  'Read-only role for the admin dashboard. Granted to authenticator so PostgREST can SET ROLE on its behalf via a custom JWT (role claim = loucels_dashboard_read).';
