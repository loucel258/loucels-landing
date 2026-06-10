-- 041_audit_logs_decouple.sql
-- Same root cause as 040 but on `audit_logs` itself: workspace_id had
-- a FK back to `clients`. The legacy chat path satisfied it because
-- ws_chat_loucel_landing was registered there, but the multi-tenant
-- agent path generates workspace_ids that exceed the clients regex and
-- aren't registered. Dropping this FK lets per-tenant agents write to
-- audit_logs while chain integrity is still enforced by prev_row_hash
-- + workspace_sequence (computed inside write_audit_entry).

alter table public.audit_logs
  drop constraint if exists audit_logs_workspace_fk;
