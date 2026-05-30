import { NextResponse } from "next/server";
import { propose } from "@/lib/hitl/queue";
import { writeAuditEntry } from "@/lib/audit/writer";
import { sha256Hex } from "@/lib/crypto/hash";
import { assertJwtStillValid, extractBearerToken, verifyWorkspaceJwt } from "@/lib/auth/jwt";
import type { HitlActionType } from "@/lib/hitl/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_ACTIONS: HitlActionType[] = [
  "send_quote",
  "send_refund",
  "reply_review",
  "send_message",
];

export async function POST(req: Request) {
  // --- AuthN: require workspace JWT (closes the anon-write hole that let
  // anyone push proposals into the supervisor queue). ---
  const token = extractBearerToken(req);
  if (!token) {
    return NextResponse.json(
      { error: "Missing Authorization Bearer token" },
      { status: 401 },
    );
  }
  let claims;
  try {
    claims = await verifyWorkspaceJwt(token);
  } catch (err) {
    return NextResponse.json(
      {
        error: "Invalid or expired token",
        detail: err instanceof Error ? err.message : "unknown",
      },
      { status: 401 },
    );
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const action_type = String(body.action_type ?? "");
  const proposed_text = String(body.proposed_text ?? "");
  const recipient = body.recipient ? String(body.recipient) : undefined;
  const risk_score =
    typeof body.risk_score === "number" ? body.risk_score : undefined;
  const risk_flags = Array.isArray(body.risk_flags)
    ? (body.risk_flags as string[])
    : [];

  if (!VALID_ACTIONS.includes(action_type as HitlActionType)) {
    return NextResponse.json(
      { error: `action_type must be one of: ${VALID_ACTIONS.join(", ")}` },
      { status: 400 },
    );
  }
  if (!proposed_text) {
    return NextResponse.json(
      { error: "Missing `proposed_text`" },
      { status: 400 },
    );
  }

  const result = await propose({
    workspace_id: claims.workspace_id,
    proposer_id: `agent_${claims.role_label ?? "default"}_${claims.sub.slice(-6)}`,
    action_type: action_type as HitlActionType,
    proposed_text,
    recipient,
    risk_score,
    risk_flags,
  });

  if (!result.ok) {
    return NextResponse.json(result, { status: result.reason === "not_configured" ? 200 : 500 });
  }

  // Re-check JWT expiry before sealing the audit entry. propose() is
  // usually fast (single insert) but if the DB stalled or the request
  // queued, the token may have aged out.
  try {
    assertJwtStillValid(claims);
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: "JWT expired before audit could be sealed",
        detail: err instanceof Error ? err.message : "unknown",
        proposal_id: result.data.id,
        warning: "Proposal was created but audit identity stale.",
      },
      { status: 401 },
    );
  }

  // Also write a forensic entry: agent proposed an action awaiting human approval.
  const ipAddress =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const auditWrite = await writeAuditEntry({
    request_id: `req_${crypto.randomUUID().slice(0, 12)}`,
    workspace_id: claims.workspace_id,
    user_id: `agent_${claims.role_label ?? "default"}_${claims.sub.slice(-6)}`,
    role: "agent",
    ip_address: ipAddress,
    source: "hitl",
    decision: "ALLOW",
    blocked_by: null,
    reason: `Agent proposed ${action_type} for human approval. proposal_id=${result.data.id}`,
    sanitized_prompt_hash: sha256Hex(proposed_text),
    detected_actions: [action_type],
  });

  // Fail-closed audit on a state-changing route: if the audit failed for a
  // real reason, we already created a `pending_approvals` row but cannot
  // prove it forensically. Roll back the row so reality matches the audit
  // log. (not_configured = demo env, skip rollback.)
  if (!auditWrite.ok && auditWrite.reason !== "not_configured") {
    console.error(
      "HITL propose audit failed — rolling back proposal",
      { proposal_id: result.data.id, error: auditWrite.error },
    );
    const { getServiceClient } = await import("@/lib/audit/client");
    const client = getServiceClient();
    if (client) {
      // Best-effort delete. If this fails too, we surface the original
      // audit failure to the caller; ops will see the orphan via the
      // monitoring janitor (TODO).
      await client.from("pending_approvals").delete().eq("id", result.data.id);
    }
    return NextResponse.json(
      {
        ok: false,
        error: "Audit write failed — proposal rolled back to keep reality and audit log in sync.",
        detail: auditWrite.error ?? "unknown",
      },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, proposal: result.data, audit: auditWrite });
}
