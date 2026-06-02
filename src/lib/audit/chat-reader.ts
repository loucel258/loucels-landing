import "server-only";
import { getAnonClient } from "./client";

export type ChatAuditRow = {
  inserted_at: string;
  workspace_sequence: number | null;
  source: string;
  decision: "ALLOW" | "DENY";
  blocked_by: string | null;
  reason: string;
  prev_row_hash: string | null;
  redaction_count: number | null;
  redaction_summary: Record<string, unknown> | null;
  model_version: string | null;
  token_usage_in: number | null;
  token_usage_out: number | null;
};

export type ReadChatTrailResult =
  | { ok: true; rows: ChatAuditRow[] }
  | { ok: false; reason: "not_configured" | "query_failed"; error?: string };

/**
 * Read the chat-audit entries for a single visitor session.
 *
 * Backed by the `read_chat_session_audit(session_id)` SECURITY DEFINER RPC
 * (migration 018), which is scoped to `ws_chat_loucel_landing` only.
 * Calling it with the anon key cannot read any other workspace or any
 * session other than the one whose token is supplied.
 */
export async function readChatSessionTrail(
  sessionId: string,
): Promise<ReadChatTrailResult> {
  if (sessionId.length < 8 || sessionId.length > 64) {
    return { ok: true, rows: [] };
  }
  const client = getAnonClient();
  if (!client) return { ok: false, reason: "not_configured" };

  const { data, error } = await client.rpc("read_chat_session_audit", {
    p_session_id: sessionId,
  });

  if (error) {
    return { ok: false, reason: "query_failed", error: error.message };
  }
  return { ok: true, rows: (data ?? []) as ChatAuditRow[] };
}
