import { NextResponse } from "next/server";
import { decide } from "@/lib/hitl/queue";
import { writeAuditEntry } from "@/lib/audit/writer";
import { normalizeRedactionSummary } from "@/lib/audit/redaction-summary";
import { sha256Hex } from "@/lib/crypto/hash";
import { assertJwtStillValid, extractBearerToken, verifyWorkspaceJwt } from "@/lib/auth/jwt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  // --- AuthN: require workspace JWT. Without this anyone could approve or
  // reject another tenant's pending actions. ---
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

  const id = String(body.id ?? "");
  const status = String(body.status ?? "");
  const decider_id = `supervisor_${claims.role_label ?? "default"}_${claims.sub.slice(-6)}`;
  const edited_text =
    typeof body.edited_text === "string" ? body.edited_text : undefined;
  const decision_reason =
    typeof body.decision_reason === "string"
      ? body.decision_reason
      : undefined;
  const force_fail = body.force_fail === true;

  if (!id) {
    return NextResponse.json({ error: "Missing `id`" }, { status: 400 });
  }
  // RFC 4122 UUID format check. PostgREST already rejects malformed
  // uuids with a 400, but validating here gives a cleaner error and
  // avoids the noisy DB log entry.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return NextResponse.json(
      { error: "`id` must be a UUID" },
      { status: 400 },
    );
  }
  if (status !== "approved" && status !== "rejected") {
    return NextResponse.json(
      { error: "`status` must be approved or rejected" },
      { status: 400 },
    );
  }

  // Cross-tenant guard: load the proposal and reject if it belongs to a
  // different workspace than the caller's JWT. The decide() RPC also
  // enforces this server-side via SECURITY DEFINER, but failing fast here
  // gives a clean 403 instead of a generic RPC error.
  const { getServiceClient } = await import("@/lib/audit/client");
  const probeClient = getServiceClient();
  if (probeClient && id) {
    const { data: probe } = await probeClient
      .from("pending_approvals")
      .select("workspace_id")
      .eq("id", id)
      .maybeSingle();
    if (probe && probe.workspace_id !== claims.workspace_id) {
      return NextResponse.json(
        { error: "Proposal belongs to a different workspace" },
        { status: 403 },
      );
    }
  }

  const result = await decide({
    id,
    status: status as "approved" | "rejected",
    decider_id,
    edited_text,
    decision_reason,
    force_fail,
  });

  // Re-check JWT expiry before any audit write. decide() runs the saga
  // (DB lock → external call up to 8s → commit/rollback); the token
  // could have expired mid-flight. We do NOT undo the saga — the row's
  // terminal state is already real — but we refuse to attribute the
  // audit entry to a stale identity.
  try {
    assertJwtStillValid(claims);
  } catch (err) {
    return NextResponse.json(
      {
        error: "JWT expired before audit could be sealed",
        detail: err instanceof Error ? err.message : "unknown",
        warning:
          "Saga may have committed; manual reconciliation required if proposal moved to terminal state.",
      },
      { status: 401 },
    );
  }

  const ipAddress =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;

  // -------------------- AUDIT WRITES -------------------------
  if (result.ok) {
    // approved+executed OR rejected
    const proposal = result.data;
    const executed = result.executed;
    const wasEdited =
      proposal.final_text != null &&
      proposal.final_text !== proposal.proposed_text;
    const externalId = "external" in result ? result.external?.external_id : undefined;
    const provider = "external" in result ? result.external?.provider : undefined;

    const auditWrite = await writeAuditEntry({
      request_id: `req_${crypto.randomUUID().slice(0, 12)}`,
      workspace_id: proposal.workspace_id,
      user_id: decider_id,
      role: "supervisor",
      ip_address: ipAddress,
      source: "hitl",
      decision: proposal.status === "approved" ? "ALLOW" : "DENY",
      blocked_by: proposal.status === "rejected" ? "human_review" : null,
      reason: buildReason({
        status: proposal.status,
        wasEdited,
        executed,
        externalId,
        provider,
        proposalId: proposal.id,
        decisionReason: decision_reason,
      }),
      sanitized_prompt_hash: sha256Hex(
        wasEdited
          ? (proposal.final_text ?? proposal.proposed_text)
          : proposal.proposed_text,
      ),
      detected_actions: [proposal.action_type],
      redaction_summary: normalizeRedactionSummary({
        kind: "hitl_decide",
        agent_draft_hash: sha256Hex(proposal.proposed_text),
        final_text_hash: sha256Hex(
          proposal.final_text ?? proposal.proposed_text,
        ),
        was_edited: wasEdited ? 1 : 0,
        diff_lines: proposal.text_diff
          ? proposal.text_diff.split("\n").length
          : 0,
      }),
    });
    // Fail-loud on terminal decisions: the state machine already moved
    // the row to approved/rejected (terminal, frozen by trigger). We
    // cannot roll back. The least-bad option is to surface the audit
    // failure loudly so ops sees it and can reconcile manually. We do
    // NOT lie to the caller — the decision DID happen, but it isn't
    // provable until audit catches up.
    if (!auditWrite.ok && auditWrite.reason !== "not_configured") {
      console.error(
        "HITL decide audit failed on terminal state — manual reconciliation required",
        { proposal_id: proposal.id, error: auditWrite.error },
      );
      return NextResponse.json(
        {
          ok: true,
          warning: "audit_write_failed",
          warning_detail: auditWrite.error ?? "unknown",
          proposal,
          executed,
          external: "external" in result ? result.external : undefined,
          audit: auditWrite,
        },
        { status: 207 }, // Multi-Status: action succeeded, audit didn't
      );
    }
    return NextResponse.json({
      ok: true,
      proposal,
      executed,
      external: "external" in result ? result.external : undefined,
      audit: auditWrite,
    });
  }

  // execution_failed — saga rolled back. Audit it as a DENY caused by infra.
  if (result.reason === "execution_failed") {
    const rollbackAudit = await writeAuditEntry({
      request_id: `req_${crypto.randomUUID().slice(0, 12)}`,
      workspace_id: result.data.workspace_id,
      user_id: decider_id,
      role: "supervisor",
      ip_address: ipAddress,
      source: "hitl",
      decision: "DENY",
      blocked_by: "external_api_failure",
      reason: `Saga rolled back. provider=${result.external.provider}. failure=${result.external.failure_reason ?? "unknown"}. proposal_id=${result.data.id}. Row returned to pending for retry.`,
      sanitized_prompt_hash: sha256Hex(
        result.data.final_text ?? result.data.proposed_text,
      ),
      detected_actions: [result.data.action_type],
      redaction_summary: normalizeRedactionSummary({
        kind: "hitl_rollback",
        agent_draft_hash: sha256Hex(result.data.proposed_text),
        final_text_hash: sha256Hex(
          result.data.final_text ?? result.data.proposed_text,
        ),
        rollback: 1,
      }),
    });
    if (!rollbackAudit.ok && rollbackAudit.reason !== "not_configured") {
      console.error(
        "HITL saga-rollback audit failed — manual reconciliation required",
        { proposal_id: result.data.id, error: rollbackAudit.error },
      );
    }
    return NextResponse.json(
      {
        ok: false,
        reason: "execution_failed",
        proposal: result.data,
        external: result.external,
        audit: rollbackAudit,
      },
      { status: 502 },
    );
  }

  if (result.reason === "edit_introduces_pii") {
    return NextResponse.json(
      {
        ok: false,
        reason: "edit_introduces_pii",
        error: `Supervisor edit introduced new PII (${result.pii_types.join(", ")}). Refusing to deliver. Remove the sensitive data or reject the proposal instead.`,
        pii_types: result.pii_types,
        pii_count: result.pii_count,
        proposal: result.data,
      },
      { status: 422 },
    );
  }

  return NextResponse.json(result, {
    status: result.reason === "not_configured" ? 200 : 400,
  });
}

function buildReason({
  status,
  wasEdited,
  executed,
  externalId,
  provider,
  proposalId,
  decisionReason,
}: {
  status: string;
  wasEdited: boolean;
  executed: boolean;
  externalId?: string;
  provider?: string;
  proposalId: string;
  decisionReason?: string;
}): string {
  if (status === "rejected") {
    return `Supervisor rejected. proposal_id=${proposalId}. reason=${decisionReason ?? "no reason given"}`;
  }
  if (executed) {
    return `Supervisor approved ${wasEdited ? "WITH EDITS" : "as-is"} and ${provider ?? "external"} delivered (external_id=${externalId ?? "n/a"}). proposal_id=${proposalId}`;
  }
  return `Supervisor approved ${wasEdited ? "WITH EDITS" : "as-is"} (no execution recorded). proposal_id=${proposalId}`;
}

