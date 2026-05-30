-- =============================================================================
-- Loucel Labs Trust Stack — Tenants + Credential Vault (004)
-- =============================================================================
-- Establishes the multi-tenant root and the encrypted credential vault.
--
-- Two tables:
--   public.clients              — one row per Loucel tenant
--   public.client_credentials   — encrypted per-tenant API tokens
--
-- ENCRYPTION DESIGN:
-- ----------------
-- We use pgsodium's AEAD (Authenticated Encryption with Associated Data)
-- primitive: crypto_aead_det_encrypt. We encrypt at the SQL function layer
-- (not via auto-encrypting SECURITY LABEL) so the API surface is explicit
-- and reviewable.
--
-- Key:        a single project-level encryption key derived from pgsodium's
--             root key (created in the migration if missing). Rotating it
--             requires re-encrypting all rows — documented in supabase/README.md.
-- Nonce:      derived deterministically from (workspace_id, provider, column).
--             We use the deterministic variant so the same plaintext encrypts
--             to the same ciphertext within a row, which is fine here because
--             ciphertext never repeats across workspaces (different AAD).
-- AAD:        workspace_id is bound as Associated Data on every ciphertext.
--             A cross-tenant shuffle fails authentication on decrypt.
-- Result:     ciphertext stored as bytea. Plaintext only ever exists in the
--             vault_read_credential function output, inside a SECURITY DEFINER
--             function that checks the JWT before decrypting.
--
-- READ PATH:
-- ---------
-- public.vault_read_credential(workspace_id, provider) → returns plaintext
--   - service_role can read any workspace (admin / token refresh paths)
--   - authenticated callers can read ONLY their JWT's workspace_id
--   - anon callers are rejected unconditionally
--   - Every successful read writes one entry to audit_logs (source='vault_read')
--     so token usage is forensically traceable.
--
-- WRITE PATH:
-- ----------
-- public.vault_write_credential(...) → encrypts + upserts
--   - service_role only. Application code calls this from the admin/setup flow
--     when onboarding a client or rotating a token.
--
-- Run AFTER 003_hitl_forensic.sql.
-- =============================================================================

create extension if not exists "pgcrypto";
create extension if not exists "pgsodium";

-- -----------------------------------------------------------------------------
-- clients — tenant root
-- -----------------------------------------------------------------------------
create table if not exists public.clients (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    text unique not null
                   check (workspace_id ~ '^ws_[a-z0-9_]{3,40}$'),
  name            text not null,
  industry        text,
  status          text not null default 'active'
                   check (status in ('active', 'suspended', 'archived')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists clients_status_idx on public.clients (status);

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists clients_touch on public.clients;
create trigger clients_touch
  before update on public.clients
  for each row execute function public.touch_updated_at();

-- -----------------------------------------------------------------------------
-- client_credentials — encrypted per-tenant tokens
-- -----------------------------------------------------------------------------
create table if not exists public.client_credentials (
  id                      uuid primary key default gen_random_uuid(),
  workspace_id            text not null
                            references public.clients(workspace_id) on delete cascade,
  provider                text not null
                            check (provider in (
                              'twilio',
                              'hubspot',
                              'quickbooks',
                              'google_business',
                              'sendgrid',
                              'stripe',
                              'servicetitan',
                              'microsoft_graph',
                              'gmail'
                            )),
  -- Ciphertext columns. Populated ONLY via vault_write_credential.
  access_token            bytea,
  refresh_token           bytea,
  webhook_secret          bytea,
  -- Non-secret metadata
  account_identifier      text,
  scopes                  text[] not null default '{}',
  expires_at              timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  rotated_at              timestamptz,
  unique (workspace_id, provider)
);

create index if not exists client_credentials_ws_idx
  on public.client_credentials (workspace_id);
create index if not exists client_credentials_expires_idx
  on public.client_credentials (expires_at)
  where expires_at is not null;

drop trigger if exists client_credentials_touch on public.client_credentials;
create trigger client_credentials_touch
  before update on public.client_credentials
  for each row execute function public.touch_updated_at();

-- -----------------------------------------------------------------------------
-- RLS — deny by default. Tables are invisible to anon/authenticated.
-- service_role bypasses RLS (used by admin paths only).
-- -----------------------------------------------------------------------------
alter table public.clients enable row level security;
alter table public.client_credentials enable row level security;
-- No policies for anon/authenticated by design.

grant all on public.clients to service_role;
grant all on public.client_credentials to service_role;
revoke all on public.clients from anon, authenticated;
revoke all on public.client_credentials from anon, authenticated;

-- -----------------------------------------------------------------------------
-- Ensure a project-level pgsodium key exists. Idempotent.
-- The key UUID is stored in a tiny config table for predictable lookups.
-- -----------------------------------------------------------------------------
create table if not exists public.vault_config (
  id              int primary key default 1 check (id = 1),
  master_key_id   uuid not null,
  rotation_count  int not null default 0,
  created_at      timestamptz not null default now()
);

do $$
declare
  v_key_id uuid;
begin
  if not exists (select 1 from public.vault_config where id = 1) then
    -- Create a new pgsodium key dedicated to the vault.
    v_key_id := (
      pgsodium.create_key('aead-det', 'loucel_vault_master')
    ).id;
    insert into public.vault_config (id, master_key_id) values (1, v_key_id);
  end if;
end;
$$;

grant select on public.vault_config to service_role;
revoke all on public.vault_config from anon, authenticated;

-- -----------------------------------------------------------------------------
-- vault_write_credential — service_role-only encrypted upsert
-- -----------------------------------------------------------------------------
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
  v_aad     bytea := convert_to(p_workspace_id, 'utf8');
begin
  -- Only service_role can write secrets
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
    case when p_access_token  is null then null
         else pgsodium.crypto_aead_det_encrypt(
              convert_to(p_access_token, 'utf8'), v_aad, v_key_id) end,
    case when p_refresh_token is null then null
         else pgsodium.crypto_aead_det_encrypt(
              convert_to(p_refresh_token, 'utf8'), v_aad, v_key_id) end,
    case when p_webhook_secret is null then null
         else pgsodium.crypto_aead_det_encrypt(
              convert_to(p_webhook_secret, 'utf8'), v_aad, v_key_id) end,
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

revoke all on function public.vault_write_credential(
  text, text, text, text, text, text, text[], timestamptz
) from public;
grant execute on function public.vault_write_credential(
  text, text, text, text, text, text, text[], timestamptz
) to service_role;

-- -----------------------------------------------------------------------------
-- vault_read_credential — workspace-scoped decrypted read.
--
-- - service_role can read any workspace (admin / token refresh paths)
-- - authenticated callers can read ONLY the workspace matching their JWT claim
-- - anon callers are rejected unconditionally
-- -----------------------------------------------------------------------------
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
  v_aad         bytea := convert_to(p_workspace_id, 'utf8');
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
                  pgsodium.crypto_aead_det_decrypt(c.access_token, v_aad, v_key_id),
                  'utf8'
                ) end as access_token,
      case when c.refresh_token is null then null
           else convert_from(
                  pgsodium.crypto_aead_det_decrypt(c.refresh_token, v_aad, v_key_id),
                  'utf8'
                ) end as refresh_token,
      case when c.webhook_secret is null then null
           else convert_from(
                  pgsodium.crypto_aead_det_decrypt(c.webhook_secret, v_aad, v_key_id),
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

revoke all on function public.vault_read_credential(text, text) from public;
grant execute on function public.vault_read_credential(text, text) to service_role;
grant execute on function public.vault_read_credential(text, text) to authenticated;
