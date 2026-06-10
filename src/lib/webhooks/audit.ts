import "server-only";
import { writeAuditEntry } from "@/lib/audit/writer";

export type WebhookSource = "cal" | "docusign" | "tally" | "stripe";

const WORKSPACE_ID = "ws_ops_webhooks";

function normalizeIp(ip: string | null | undefined): string | null {
  if (!ip) return null;
  const t = ip.trim();
  if (!t || t === "unknown") return null;
  return t;
}

function getClientIp(req: Request): string | null {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]?.trim() ?? null;
  return req.headers.get("x-real-ip");
}

async function safeWrite(entry: Parameters<typeof writeAuditEntry>[0]): Promise<void> {
  try {
    await writeAuditEntry(entry);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[webhook-audit] write failed:", err);
  }
}

export async function auditWebhookSignatureInvalid(
  source: WebhookSource,
  req: Request,
): Promise<void> {
  await safeWrite({
    request_id: crypto.randomUUID(),
    workspace_id: WORKSPACE_ID,
    user_id: `webhook_${source}`,
    role: "system",
    ip_address: normalizeIp(getClientIp(req)),
    source: "webhook",
    sanitized_prompt_hash: "",
    decision: "DENY",
    blocked_by: "webhook_signature_invalid",
    reason: `Invalid signature on ${source} webhook`,
  });
}

export async function auditWebhookReplay(
  source: WebhookSource,
  req: Request,
  eventId: string,
): Promise<void> {
  await safeWrite({
    request_id: crypto.randomUUID(),
    workspace_id: WORKSPACE_ID,
    user_id: `webhook_${source}`,
    role: "system",
    ip_address: normalizeIp(getClientIp(req)),
    source: "webhook",
    sanitized_prompt_hash: "",
    decision: "DENY",
    blocked_by: "webhook_replay",
    reason: `Duplicate ${source} event ${eventId.slice(0, 80)}`,
  });
}
