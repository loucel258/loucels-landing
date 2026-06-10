-- 040_audit_chain_head_decouple.sql
-- Decouple audit_chain_head from the legacy `clients` table. The
-- multi-tenant agent path (client_agents) uses workspace_ids that
-- exceed the clients.workspace_id CHECK regex length, so the genesis
-- insert in write_audit_entry fails with FK violation and the chat
-- handler's try/catch silently drops every audit write.
--
-- Removing the FK is safe: write_audit_entry already manages chain
-- integrity via SHA-256 prev_row_hash + workspace_sequence — those
-- give us the per-workspace ordering guarantee. The FK to clients
-- only enforced "this workspace was registered first", which doesn't
-- hold any longer now that we have two distinct workspace registries
-- (clients for the legacy chat, client_agents for tenants).

alter table public.audit_chain_head
  drop constraint if exists audit_chain_head_workspace_id_fkey;
