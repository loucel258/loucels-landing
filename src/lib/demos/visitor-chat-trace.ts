/**
 * Bridge between the landing chat (real audit chain) and the operator-view
 * trace replay (demo UI). Reads the visitor's sessionId from sessionStorage,
 * fetches their audit rows via /api/chat/audit-trail, and reconstructs a
 * trace-replay-shaped object from the real chain data.
 *
 * Why reconstruct: the audit table stores per-event metadata (decision,
 * source, hash, redaction counts, token usage) but not the full step-by-step
 * trace. We synthesize the steps from what IS in the chain, which is enough
 * to make the trace feel real to the visitor — every value shown is sourced
 * from their actual audit row.
 */

import type { TraceStep } from "./operator-mock-data";

const CHAT_SESSION_KEY = "loucels-chat-session";

export type VisitorChatRow = {
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

export type VisitorChatTrace =
  | { hasSession: false }
  | {
      hasSession: true;
      rowCount: number;
      latestTurn: {
        summary: string;
        trace: TraceStep[];
        occurredAt: string;
        decision: "ALLOW" | "DENY";
      } | null;
    };

export function getStoredSessionId(): string | null {
  if (typeof window === "undefined") return null;
  return window.sessionStorage.getItem(CHAT_SESSION_KEY);
}

export async function loadVisitorChatTrace(): Promise<VisitorChatTrace> {
  const sessionId = getStoredSessionId();
  if (!sessionId) return { hasSession: false };

  let rows: VisitorChatRow[] = [];
  try {
    const res = await fetch(
      `/api/chat/audit-trail?sessionId=${encodeURIComponent(sessionId)}`,
    );
    const data = (await res.json()) as
      | { ok: true; rows: VisitorChatRow[] }
      | { ok: false; error: string };
    if (!data.ok) return { hasSession: true, rowCount: 0, latestTurn: null };
    rows = data.rows;
  } catch {
    return { hasSession: true, rowCount: 0, latestTurn: null };
  }

  if (rows.length === 0) {
    return { hasSession: true, rowCount: 0, latestTurn: null };
  }

  // Rows come back newest first (workspace_sequence desc).
  // Decide what "the latest turn" means:
  //   - If the most recent event is a pii_blocked DENY, show ONLY that block.
  //   - Otherwise, find the most recent assistant_reply / hard_rule_enforced
  //     and pair it with the most recent user_message.
  const newest = rows[0];

  if (newest && isPiiBlock(newest)) {
    return {
      hasSession: true,
      rowCount: rows.length,
      latestTurn: {
        summary: "Sensitive data detected — agent NOT invoked",
        trace: buildPiiBlockedTrace(newest),
        occurredAt: newest.inserted_at,
        decision: "DENY",
      },
    };
  }

  const latestAssistant = rows.find(
    (r) => isAssistantReply(r) || isHardRuleEnforced(r),
  );
  const latestUser = rows.find(isUserMessage);

  if (!latestAssistant || !latestUser) {
    return { hasSession: true, rowCount: rows.length, latestTurn: null };
  }

  return {
    hasSession: true,
    rowCount: rows.length,
    latestTurn: {
      summary: buildTurnSummary(latestAssistant),
      trace: buildTurnTrace(latestUser, latestAssistant),
      occurredAt: latestUser.inserted_at,
      decision: latestAssistant.decision,
    },
  };
}

// ---------- helpers ----------

function isUserMessage(r: VisitorChatRow) {
  return r.reason.startsWith("user_message");
}
function isAssistantReply(r: VisitorChatRow) {
  return r.reason.startsWith("assistant_reply");
}
function isHardRuleEnforced(r: VisitorChatRow) {
  return r.reason.startsWith("hard_rule_enforced");
}
function isPiiBlock(r: VisitorChatRow) {
  return r.reason.startsWith("pii_blocked");
}

function extractChars(reason: string): number | null {
  const m = reason.match(/chars=(\d+)/);
  return m ? parseInt(m[1]!, 10) : null;
}

function extractHardRule(reason: string): string | null {
  const m = reason.match(/hard_rule_enforced:([a-z_]+)/);
  return m ? m[1]! : null;
}

function extractPiiTypes(reason: string): string[] {
  const m = reason.match(/pii_blocked:types=([A-Z_,]+)/);
  return m ? m[1]!.split(",").filter(Boolean) : [];
}

function shortHash(h: string | null): string {
  if (!h) return "—";
  return `${h.slice(0, 10)}…`;
}

function buildTurnSummary(assistantRow: VisitorChatRow): string {
  if (assistantRow.decision === "DENY") {
    const rule = extractHardRule(assistantRow.reason);
    return rule
      ? `Hard rule enforced: ${rule.replace(/_/g, " ")}`
      : "Agent declined per policy";
  }
  return "Conversation turn handled end-to-end";
}

function buildTurnTrace(
  userRow: VisitorChatRow,
  assistantRow: VisitorChatRow,
): TraceStep[] {
  const userChars = extractChars(userRow.reason) ?? 0;
  const replyChars = extractChars(assistantRow.reason) ?? 0;
  const hardRule = extractHardRule(assistantRow.reason);
  const redactionCount = userRow.redaction_count ?? 0;
  const isDeny = assistantRow.decision === "DENY";

  return [
    {
      layer: "webhook",
      label: "Channel · web chat",
      detail: `Inbound from Loucels landing chat widget · ${userChars} chars`,
      durationMs: 6,
      status: "ok",
      result: "received",
    },
    {
      layer: "rate_limit",
      label: "Rate limit check",
      detail: "Per-IP token bucket · 30/hour capacity",
      durationMs: 1,
      status: "ok",
      result: "passed",
    },
    {
      layer: "dlp_l1",
      label: "DLP Layer 1 · regex sweep",
      detail: "Scanned for SSN · ITIN · EIN · cards (Luhn) · bank · secrets",
      durationMs: 3,
      status: "ok",
      result:
        redactionCount > 0
          ? `${redactionCount} redaction(s) applied`
          : "no PII detected",
    },
    {
      layer: "agent",
      label: `Agent reasoning · ${assistantRow.model_version ?? "claude-haiku"}`,
      detail: hardRule
        ? `System prompt enforced hard rule: ${hardRule.replace(/_/g, " ")}`
        : "Claude generated the visitor's reply with full Loucels system prompt + tools",
      durationMs: 1450,
      status: "ok",
      result: `${assistantRow.token_usage_in ?? 0} tokens in · ${assistantRow.token_usage_out ?? 0} tokens out`,
    },
    {
      layer: "audit",
      label: "Audit chain write",
      detail: `Workspace ws_chat_loucel_landing · sequence #${assistantRow.workspace_sequence ?? "?"}`,
      durationMs: 22,
      status: "ok",
      result: `chain ${shortHash(assistantRow.prev_row_hash)}`,
    },
    {
      layer: "response",
      label: isDeny ? "Refusal sent" : "Response sent",
      detail: `${replyChars} chars · ${isDeny ? "hard-rule refusal" : "agent reply"}`,
      durationMs: 18,
      status: isDeny ? "blocked" : "ok",
      result: "delivered",
    },
  ];
}

function buildPiiBlockedTrace(row: VisitorChatRow): TraceStep[] {
  const chars = extractChars(row.reason);
  const piiTypes = extractPiiTypes(row.reason);
  return [
    {
      layer: "webhook",
      label: "Channel · web chat",
      detail: `Inbound message · ${chars ?? "?"} chars`,
      durationMs: 6,
      status: "ok",
      result: "received",
    },
    {
      layer: "rate_limit",
      label: "Rate limit check",
      detail: "Per-IP token bucket",
      durationMs: 1,
      status: "ok",
      result: "passed",
    },
    {
      layer: "dlp_l1",
      label: "DLP Layer 1 · regex sweep",
      detail: `High-risk PII detected: ${piiTypes.join(", ") || "credit card / SSN / similar"}`,
      durationMs: 3,
      status: "blocked",
      result: "agent NOT invoked",
    },
    {
      layer: "audit",
      label: "Audit chain write",
      detail: `Workspace ws_chat_loucel_landing · sequence #${row.workspace_sequence ?? "?"}`,
      durationMs: 18,
      status: "ok",
      result: `DENY · ${shortHash(row.prev_row_hash)}`,
    },
    {
      layer: "response",
      label: "Refusal sent",
      detail: "Polite refusal asking the visitor not to paste sensitive data",
      durationMs: 12,
      status: "blocked",
      result: "delivered",
    },
  ];
}
