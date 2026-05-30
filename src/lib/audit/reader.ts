import "server-only";
import { getAnonClient } from "./client";
import type { AuditEntryRow } from "./types";

export type ReadResult =
  | { ok: true; rows: AuditEntryRow[] }
  | { ok: false; reason: "not_configured" | "query_failed"; error?: string };

/**
 * Read the most recent entries from the redacted demo view. RLS makes sure
 * that even with the anon key the underlying raw rows are not exposed —
 * the view masks user_id and omits IP.
 */
export async function readRecentEntries(limit = 50): Promise<ReadResult> {
  const client = getAnonClient();
  if (!client) return { ok: false, reason: "not_configured" };

  const { data, error } = await client
    .from("audit_logs_demo_view")
    .select("*")
    .order("inserted_at", { ascending: false })
    .limit(limit);

  if (error) {
    return { ok: false, reason: "query_failed", error: error.message };
  }
  return { ok: true, rows: (data ?? []) as AuditEntryRow[] };
}
