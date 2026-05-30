-- =============================================================================
-- 013_vault_aad_binding.sql
-- =============================================================================
-- Tightens AEAD Associated Data on the credential vault.
--
-- BACKGROUND
-- ----------
-- Migration 004 used `AAD = workspace_id` for all three encrypted columns
-- (access_token, refresh_token, webhook_secret) across all providers in a
-- workspace. That is enough to stop cross-tenant shuffle attacks — moving
-- ciphertext between workspaces fails authentication — but it does NOT
-- stop two intra-tenant attacks an actor with raw INSERT/UPDATE on
-- public.client_credentials could perform:
--
--   (a) Cross-column swap: copy the ciphertext from `webhook_secret` into
--       `access_token` on the same row. AAD matches, so decrypt returns
--       the webhook secret as if it were the access token. The caller
--       then uses the wrong secret in the wrong protocol.
--
--   (b) Cross-provider swap (same workspace): take the ciphertext of
--       Twilio's `access_token` and paste it into Stripe's row. AAD still
--       matches workspace_id, decrypt succeeds, and the caller signs
--       Stripe requests with the Twilio key.
--
-- THIS MIGRATION
-- --------------
-- Binds AAD to (workspace_id || '|' || provider || '|' || column_name)
-- in BOTH the writer and reader. Now any cross-column or cross-provider
-- shuffle fails `crypto_aead_det_decrypt` with an authentication error
-- instead of silently returning the wrong secret.
--
-- BACKWARDS COMPATIBILITY
-- -----------------------
-- Old ciphertexts encrypted under the workspace-only AAD will not decrypt
-- under the new function. We are not yet in production, so we wipe the
-- table and let callers re-upsert via vault_write_credential (which now
-- writes with the strict AAD). If/when production rows exist, this
-- migration would need a re-encrypt step instead of a truncate — see the
-- commented block at the bottom for the shape of that path.
-- =============================================================================

-- ---- one-time clean slate (demo only — remove the TRUNCATE for prod) ----
truncate table public.client_credentials;

-- ----------------------------------------------------------------------------
-- AAD helper: pure SQL so it inlines and stays consistent between writer
-- and reader. Format: 'ws=<workspace_id>|prov=<provider>|col=<column>'.
-- ----------------------------------------------------------------------------
create or replace function public.vault_aad(
  p_workspace_id text,
  p_provider     text,
  p_column       text
) returns bytea
language sql
immutable
set search_path = public
as $$
  select convert_to(
    'ws=' || p_workspace_id || '|prov=' || p_provider || '|col=' || p_column,
    'utf8'
  );
$$;

revoke all on function public.vault_aad(text, text, text) from public;
grant execute on function public.vault_aad(text, text, text) to service_role;
grant execute on function public.vault_aad(text, text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- vault_write_credential — re-bound AAD per column.
-- ----------------------------------------------------------------------------
create or replace function public.vault_write_credential(
  p_workspace_id        text,
  p_provider            text,
  p_access_token        text,
  p_refresh_token       text default null,
  p_webhook_secret      text default null,
  p_account_identifier  text default null,
  p_scopes              text[] default '{}',
  p_expires_at          timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pgsodium
as $$
declare
  v_key_id  uuid;
  v_id      uuid;
begin
  if coalesce(current_setting('request.jwt.claims', true)::json->>'role', '') != 'service_role'
     and current_user not in ('postgres', 'supabase_admin') then
    raise exception 'vault_write_credential: caller is not authorized' using errcode = '42501';
  end if;

  select master_key_id into v_key_id from public.vault_config where id = 1;
  if v_key_id is null then
    raise exception 'vault_write_credential: master key not initialized';
  end if;

  insert into public.client_credentials (
    workspace_id, provider,
    access_token, refresh_token, webhook_secret,
    account_identifier, scopes, expires_at, rotated_at
  )
  values (
    p_workspace_id, p_provider,
    case when p_access_token is null then null
         else pgsodium.crypto_aead_det_encrypt(
                convert_to(p_access_token, 'utf8'),
                public.vault_aad(p_workspace_id, p_provider, 'access_token'),
                v_key_id) end,
    case when p_refresh_token is null then null
         else pgsodium.crypto_aead_det_encrypt(
                convert_to(p_refresh_token, 'utf8'),
                public.vault_aad(p_workspace_id, p_provider, 'refresh_token'),
                v_key_id) end,
    case when p_webhook_secret is null then null
         else pgsodium.crypto_aead_det_encrypt(
                convert_to(p_webhook_secret, 'utf8'),
                public.vault_aad(p_workspace_id, p_provider, 'webhook_secret'),
                v_key_id) end,
    p_account_identifier, p_scopes, p_expires_at, now()
  )
  on conflict (workspace_id, provider) do update set
    access_token       = excluded.access_token,
    refresh_token      = excluded.refresh_token,
    webhook_secret     = excluded.webhook_secret,
    account_identifier = excluded.account_identifier,
    scopes             = excluded.scopes,
    expires_at         = excluded.expires_at,
    rotated_at         = now()
  returning id into v_id;

  return v_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- vault_read_credential — matching per-column AAD on decrypt.
-- ----------------------------------------------------------------------------
create or replace function public.vault_read_credential(
  p_workspace_id text,
  p_provider     text
)
returns table (
  provider           text,
  access_token       text,
  refresh_token      text,
  webhook_secret     text,
  account_identifier text,
  scopes             text[],
  expires_at         timestamptz
)
language plpgsql
security definer
set search_path = public, pgsodium
as $$
declare
  v_caller_role text;
  v_caller_ws   text;
  v_key_id      uuid;
begin
  v_caller_role := coalesce(
    current_setting('request.jwt.claims', true)::json->>'role',
    case when current_user in ('postgres', 'supabase_admin') then 'service_role' else 'anon' end
  );
  v_caller_ws := current_setting('request.jwt.claims', true)::json->>'workspace_id';

  if v_caller_role = 'anon' then
    raise exception 'access denied' using errcode = '42501';
  end if;

  if v_caller_role = 'authenticated'
     and (v_caller_ws is null or v_caller_ws is distinct from p_workspace_id) then
    raise exception 'access denied' using errcode = '42501';
  end if;

  select master_key_id into v_key_id from public.vault_config where id = 1;
  if v_key_id is null then
    raise exception 'vault not initialized';
  end if;

  return query
    select
      c.provider,
      case when c.access_token is null then null
           else convert_from(
                  pgsodium.crypto_aead_det_decrypt(
                    c.access_token,
                    public.vault_aad(p_workspace_id, c.provider, 'access_token'),
                    v_key_id),
                  'utf8'
                ) end as access_token,
      case when c.refresh_token is null then null
           else convert_from(
                  pgsodium.crypto_aead_det_decrypt(
                    c.refresh_token,
                    public.vault_aad(p_workspace_id, c.provider, 'refresh_token'),
                    v_key_id),
                  'utf8'
                ) end as refresh_token,
      case when c.webhook_secret is null then null
           else convert_from(
                  pgsodium.crypto_aead_det_decrypt(
                    c.webhook_secret,
                    public.vault_aad(p_workspace_id, c.provider, 'webhook_secret'),
                    v_key_id),
                  'utf8'
                ) end as webhook_secret,
      c.account_identifier,
      c.scopes,
      c.expires_at
  from public.client_credentials c
  where c.workspace_id = p_workspace_id
    and c.provider = p_provider;
end;
$$;

-- ----------------------------------------------------------------------------
-- PROD REKEY PATH (sketch — do NOT run unless you have prod rows to migrate)
-- ----------------------------------------------------------------------------
-- For each existing row, decrypt with old AAD (= workspace_id) using the
-- same v_key_id, then re-encrypt with new AAD via public.vault_aad(...).
-- Wrap in a single transaction, take a backup first, run during a
-- maintenance window. Example shape:
--
--   update public.client_credentials c set
--     access_token = pgsodium.crypto_aead_det_encrypt(
--       pgsodium.crypto_aead_det_decrypt(
--         c.access_token, convert_to(c.workspace_id,'utf8'), v_key_id),
--       public.vault_aad(c.workspace_id, c.provider, 'access_token'),
--       v_key_id)
--   where c.access_token is not null;
--
-- (Repeat for refresh_token, webhook_secret.)
-- ----------------------------------------------------------------------------
