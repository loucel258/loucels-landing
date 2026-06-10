import "server-only";
import { getServiceClient } from "@/lib/audit/client";
import { sendInternalAlert, sendEmail } from "@/lib/notify/resend";
import { writeAuditEntry } from "@/lib/audit/writer";

/**
 * Shared logic for portal-side HITL approve/reject. Both endpoints call
 * into here so the audit-row + side-effects shape is identical regardless
 * of channel.
 *
 * Action handling strategy (hybrid):
 *   - send_message:   REAL — emits the email via Resend right now
 *   - send_quote / send_refund / reply_review: STUB — flips status to
 *     'approved' and pings Steven with full context so he can execute
 *     the upstream side-effect manually. Portal UI tells the client:
 *     "Approved. Loucels is executing — confirmation in 1 business hour."
 */

export type ApproveOptions = {
  approvalId: string;
  workspaceId: string;
  decider: string;            // 'portal:<slug>' or 'admin:steven'
  editedText?: string;
  clientSlug: string;
};

export type RejectOptions = {
  approvalId: string;
  workspaceId: string;
  decider: string;
  reason?: string;
  clientSlug: string;
};

type ApprovalRow = {
  id: string;
  workspace_id: string;
  action_type: string;
  recipient: string | null;
  proposed_text: string;
  edited_text: string | null;
  status: string;
  risk_score: number | null;
};

const REAL_HANDLERS = new Set(["send_message"]);

export async function approveAction(opts: ApproveOptions): Promise<
  | { ok: true; executedRealtime: boolean }
  | { ok: false; reason: "not_found" | "already_decided" | "service_unavailable" | "exec_failed" }
> {
  const sb = getServiceClient();
  if (!sb) return { ok: false, reason: "service_unavailable" };

  const { data: row } = await sb
    .from("pending_approvals")
    .select("*")
    .eq("id", opts.approvalId)
    .eq("workspace_id", opts.workspaceId)
    .maybeSingle();

  if (!row) return { ok: false, reason: "not_found" };
  const approval = row as ApprovalRow;
  if (approval.status !== "pending") return { ok: false, reason: "already_decided" };

  const finalText = opts.editedText?.trim() || approval.proposed_text;
  const isReal = REAL_HANDLERS.has(approval.action_type);

  let executedRealtime = false;
  if (isReal && approval.action_type === "send_message" && approval.recipient) {
    // Real handler: send the message via Resend to the actual recipient
    const sent = await sendEmail({
      to: approval.recipient,
      subject: `Message from ${opts.clientSlug}`,
      html: `<div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;padding:24px;">${finalText.replace(/\n/g, "<br>")}</div>`,
    });
    if (sent.ok) {
      executedRealtime = true;
    } else {
      // Fall back to stub path so the user-facing flow is not blocked
      // eslint-disable-next-line no-console
      console.warn("[hitl] send_message Resend failed, falling back to stub");
    }
  }

  // Flip status
  const { error: updateErr } = await sb
    .from("pending_approvals")
    .update({
      status: "approved",
      decider_id: opts.decider,
      decision_reason: executedRealtime ? "auto-executed via Resend" : "queued for manual exec",
      edited_text: opts.editedText ?? null,
      decided_at: new Date().toISOString(),
    })
    .eq("id", approval.id);

  if (updateErr) {
    return { ok: false, reason: "exec_failed" };
  }

  // Notify Steven if this is a stub action — he needs to execute manually
  if (!executedRealtime) {
    await sendInternalAlert({
      subject: `[Action required] ${approval.action_type} approved by client ${opts.clientSlug}`,
      bodyHtml: `
        <p>Client portal user <strong>${opts.decider}</strong> just approved a <strong>${approval.action_type}</strong> action that requires manual execution.</p>
        <p><strong>Recipient:</strong> ${approval.recipient ?? "—"}</p>
        <p><strong>Risk score:</strong> ${approval.risk_score ?? "—"}</p>
        <p><strong>Text to send:</strong></p>
        <pre style="background:#f5f5f5;padding:12px;border-radius:6px;white-space:pre-wrap;font-family:inherit;">${escapeHtml(finalText)}</pre>
        <p style="color:#888;font-size:11px;">Approval id: ${approval.id}</p>
      `,
    });
  }

  // Append to audit chain (source='portal')
  await writeAuditEntry({
    request_id: crypto.randomUUID(),
    workspace_id: opts.workspaceId,
    user_id: opts.decider,
    role: "client_portal",
    ip_address: null,
    source: "portal",
    sanitized_prompt_hash: "",
    decision: "ALLOW",
    blocked_by: null,
    reason: `hitl_approved:${approval.action_type}${executedRealtime ? ":auto" : ":queued"}`,
  });

  return { ok: true, executedRealtime };
}

export async function rejectAction(opts: RejectOptions): Promise<
  | { ok: true }
  | { ok: false; reason: "not_found" | "already_decided" | "service_unavailable" }
> {
  const sb = getServiceClient();
  if (!sb) return { ok: false, reason: "service_unavailable" };

  const { data: row } = await sb
    .from("pending_approvals")
    .select("id, status, action_type, recipient")
    .eq("id", opts.approvalId)
    .eq("workspace_id", opts.workspaceId)
    .maybeSingle();

  if (!row) return { ok: false, reason: "not_found" };
  if ((row as { status: string }).status !== "pending") {
    return { ok: false, reason: "already_decided" };
  }

  await sb
    .from("pending_approvals")
    .update({
      status: "rejected",
      decider_id: opts.decider,
      decision_reason: opts.reason ?? "rejected by client",
      decided_at: new Date().toISOString(),
    })
    .eq("id", opts.approvalId);

  await sendInternalAlert({
    subject: `Client rejected agent action — ${(row as { action_type: string }).action_type}`,
    bodyHtml: `
      <p>Client <strong>${opts.clientSlug}</strong> rejected a pending action.</p>
      <p><strong>Reason given:</strong> ${escapeHtml(opts.reason ?? "(none)")}</p>
      <p style="color:#888;font-size:11px;">Approval id: ${opts.approvalId}</p>
    `,
  });

  await writeAuditEntry({
    request_id: crypto.randomUUID(),
    workspace_id: opts.workspaceId,
    user_id: opts.decider,
    role: "client_portal",
    ip_address: null,
    source: "portal",
    sanitized_prompt_hash: "",
    decision: "DENY",
    blocked_by: "client_rejected",
    reason: `hitl_rejected:${(row as { action_type: string }).action_type}`,
  });

  return { ok: true };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
