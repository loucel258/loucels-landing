# Migration process

The Supabase project is managed by hand (SQL editor), not `supabase db push`.
That divergence caused four production-grade bugs on 2026-06-10 (missing
service_role GRANTs ×2, a CHECK constraint missing 'agent', two stale FKs).
Until we wire the CLI, this file is the source of truth for what has been
applied.

## Rules

1. Every schema change is a numbered file in `supabase/migrations/`. No
   ad-hoc SQL that isn't captured in a migration file.
2. After applying a migration in the SQL editor, mark it ✅ here in the
   same commit.
3. New tables with RLS **must** include
   `grant insert, select, update, delete on <table> to service_role;`
   in the same migration. Supabase does NOT auto-grant on raw-SQL tables
   (root cause of migrations 032, 037, 039).
4. When a route writes a new `source` value to `audit_logs`, extend the
   CHECK constraint in the same migration (see 027, 034, 038).

## Status

All migrations `001` → `041` applied to the shared dev/prod project as of
2026-06-10 (verified working end-to-end: agent chat → audit chain →
encrypted transcripts → leads).

| Range | Notes |
| --- | --- |
| 001–020 | Trust Stack core: audit chain, DLP, RBAC, vault, demo grants |
| 021–026 | Leads, engagements, client_agents, portal foundations |
| 027–029 | Audit source 'webhook', webhook_seen, dashboard read role |
| 031–032 | Workspace + portal tables, portal service_role grants |
| 033–036 | Conversation messages, value levers, customers/tags/takeover, multi-tenant agents |
| 037 | client_agents service_role grant |
| 038 | audit source 'agent' |
| 039 | Multi-tenant table grants sweep |
| 040–041 | Decouple audit_chain_head + audit_logs from legacy clients FK |
