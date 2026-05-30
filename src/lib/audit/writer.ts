import "server-only";
import { getServiceClient } from "./client";
import type { AuditEntry } from "./types";
import { sha256Hex } from "@/lib/crypto/hash";

export type WriteResult =
  | { ok: true; id: string; chain_hash: string; sequence: number }
  | { ok: false; reason: "not_configured" | "insert_failed"; error?: string };

/**
 * Append a row to the immutable audit_logs table via the atomic
 * `write_audit_entry` Postgres RPC (migration 008).
 *
 * Why an RPC: the chain head + insert must happen under a per-workspace
 * lock (SELECT ... FOR UPDATE on `audit_chain_head`) or two concurrent
 * writers will fork the chain. Doing the read + compute + insert in two
 * separate queries from app code — as we did before — was race-prone and
 * broke the tamper-evidence guarantee under any concurrency.
 *
 * Chain construction:
 *   1. App computes SHA-256 of the canonical row (stable JSON shape).
 *   2. RPC takes that hash, chains it with the workspace's previous
 *      chain hash inside the transaction.
 *   3. RPC persists the row + advances `audit_chain_head` atomically.
 *
 * If Supabase is not configured (demo env without env vars), we return
 * `not_configured` so the caller can decide whether to surface a warning
 * or fail-closed.
 */
export async function writeAuditEntry(
  entry: AuditEntry,
): Promise<WriteResult> {
  const client = getServiceClient();
  if (!client) return { ok: false, reason: "not_configured" };

  const promptHash =
    entry.sanitized_prompt_hash && entry.sanitized_prompt_hash.length > 0
      ? entry.sanitized_prompt_hash
      : entry.plain_prompt_for_hash
        ? sha256Hex(entry.plain_prompt_for_hash)
        : "";

  // The chain hash is computed entirely SQL-side by the `audit_canonical_row`
  // helper inside write_audit_entry. We no longer pass a TS-canonicalized
  // hash because that created a writer/verifier formula mismatch (the
  // verifier walks rows in pure SQL and cannot re-run TypeScript). Source
  // of truth lives where the auditor lives — in the database.
  const { data, error } = await client.rpc("write_audit_entry", {
    p_request_id: entry.request_id,
    p_workspace_id: entry.workspace_id,
    p_user_id: entry.user_id,
    p_role: entry.role,
    p_ip_address: entry.ip_address,
    p_source: entry.source,
    p_decision: entry.decision,
    p_blocked_by: entry.blocked_by,
    p_reason: entry.reason,
    p_sanitized_prompt_hash: promptHash,
    p_detected_scopes: entry.detected_scopes ?? [],
    p_detected_actions: entry.detected_actions ?? [],
    p_prompt_injection_match_count: entry.prompt_injection_match_count ?? 0,
    p_redaction_count: entry.redaction_count ?? 0,
    p_redaction_summary: entry.redaction_summary ?? {},
    p_model_version: entry.model_version ?? null,
    p_token_usage_in: entry.token_usage_in ?? null,
    p_token_usage_out: entry.token_usage_out ?? null,
  });

  if (error) {
    return { ok: false, reason: "insert_failed", error: error.message };
  }
  // RPC returns a single-row table (id, chain_hash, sequence).
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) {
    return { ok: false, reason: "insert_failed", error: "RPC returned no row" };
  }
  return {
    ok: true,
    id: row.id as string,
    chain_hash: row.chain_hash as string,
    sequence: Number(row.sequence),
  };
}

