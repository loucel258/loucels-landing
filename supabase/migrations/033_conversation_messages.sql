-- 033_conversation_messages.sql
-- Persist plaintext transcripts of agent <-> end-user conversations so the
-- client portal can show a human-readable "Bandeja" (inbox). The audit
-- chain stays hash-only by design; this table is a DIFFERENT surface with
-- different governance rules:
--
--   - Ciphertext at rest (AES-256-GCM). Key derived from
--     CONVERSATION_ENCRYPTION_KEY env + engagement_id, so a workspace-id
--     leak alone cannot decrypt another client's messages.
--   - TTL per engagement (default 90 days). A daily Vercel cron purges
--     expired rows. The audit chain still holds the immutable hash.
--   - RLS-enabled. Service role inserts; the portal reads via a dedicated
--     RPC scoped to the calling client's slug.
--
-- This is a deliberate trade-off: we give up "zero plaintext ever" for
-- "client can actually inspect what their agent said". The audit chain
-- remains the source of truth for tamper detection.

create table if not exists public.conversation_messages (
  id              uuid primary key default gen_random_uuid(),
  engagement_id   uuid not null references public.engagements(id) on delete cascade,
  workspace_id    text not null,                        -- agent's workspace_id
  session_id      text not null,
  role            text not null check (role in ('user', 'assistant', 'tool', 'system_event')),
  -- AES-256-GCM ciphertext, base64. iv + authTag + cipher concatenated.
  -- Format: base64(iv[12] || authTag[16] || ciphertext).
  cipher_b64      text not null,
  -- Optional human-readable summary for tool calls (e.g. "Booked Maria for
  -- Friday 3pm"). Stored plaintext because it never contains PII — just
  -- the translation of a JSON tool call into a humanlike line.
  tool_summary    text,
  inserted_at     timestamptz not null default now(),
  -- Materialized expiry computed on insert from engagement's retention.
  expires_at      timestamptz not null,
  -- Optional FK to audit_logs row that recorded the same turn (hash side).
  audit_log_id    uuid
);

create index if not exists conversation_messages_session_idx
  on public.conversation_messages (session_id, inserted_at);
create index if not exists conversation_messages_workspace_idx
  on public.conversation_messages (workspace_id, inserted_at desc);
create index if not exists conversation_messages_expires_idx
  on public.conversation_messages (expires_at);

alter table public.conversation_messages enable row level security;

grant insert, select, delete on table public.conversation_messages to service_role;

comment on table public.conversation_messages is
  'Plaintext (via AES-256-GCM ciphertext) message store for portal Bandeja. Subject to TTL retention. The audit_logs chain remains the immutable source of truth for tamper detection.';
