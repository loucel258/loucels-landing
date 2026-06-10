import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { z } from "zod";
import { applyDocuSignWebhook } from "@/lib/engagements/engagements";
import { sendInternalAlert } from "@/lib/notify/resend";
import { getServiceClient } from "@/lib/audit/client";
import { rejectIfTooLarge } from "@/lib/http/body-guard";
import { claimWebhook } from "@/lib/webhooks/dedupe";
import { auditWebhookSignatureInvalid, auditWebhookReplay } from "@/lib/webhooks/audit";

const MAX_WEBHOOK_BYTES = 64 * 1024;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * DocuSign Connect webhook receiver.
 *
 * Closes GAP-D1 (manual DocuSign↔Stripe correlation). Steven sets up a
 * DocuSign Connect listener pointed at this URL with HMAC signing.
 *
 * Setup (Steven, one-time):
 *   1. DocuSign Admin → Connect → Add Configuration → Custom Configuration
 *   2. URL: https://loucels.com/api/webhooks/docusign
 *   3. Format: JSON
 *   4. Enable HMAC: yes; generate a secret, copy it to Vercel env as
 *      DOCUSIGN_HMAC_SECRET
 *   5. Trigger events: Envelope Completed, Envelope Declined, Envelope Voided
 *   6. Include: Recipient Information, Documents (we only read email and uid)
 *
 * Security:
 *   - HMAC verification against DOCUSIGN_HMAC_SECRET (DocuSign sends
 *     X-DocuSign-Signature-1 header with base64 HMAC-SHA256)
 *   - Without the secret env var, returns 503 (fails closed)
 *
 * Idempotency: DocuSign retries on 5xx. `applyDocuSignWebhook` matches by
 * envelope_id first so re-delivery is a no-op (same row, same final state).
 */

const PayloadSchema = z.object({
  event: z.string(),                              // "envelope-completed" | "envelope-declined" | ...
  data: z.object({
    envelopeId: z.string().min(1),
    envelopeSummary: z
      .object({
        completedDateTime: z.string().optional(),
        recipients: z
          .object({
            signers: z
              .array(
                z.object({
                  email: z.string().email(),
                }),
              )
              .min(1),
          })
          .optional(),
      })
      .optional(),
  }),
});

function verifyDocuSignSignature(rawBody: string, headerValue: string | null): boolean {
  const secret = process.env.DOCUSIGN_HMAC_SECRET;
  if (!secret || !headerValue) return false;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(rawBody, "utf-8")
    .digest("base64");
  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected, "base64"),
      Buffer.from(headerValue, "base64"),
    );
  } catch {
    return false;
  }
}

function mapEvent(event: string): "envelope_completed" | "envelope_declined" | "envelope_voided" | null {
  const lower = event.toLowerCase();
  if (lower.includes("complete")) return "envelope_completed";
  if (lower.includes("decline")) return "envelope_declined";
  if (lower.includes("void")) return "envelope_voided";
  return null;
}

export async function POST(req: Request): Promise<Response> {
  const tooLarge = rejectIfTooLarge(req, MAX_WEBHOOK_BYTES);
  if (tooLarge) return tooLarge;

  if (!process.env.DOCUSIGN_HMAC_SECRET) {
    // eslint-disable-next-line no-console
    console.warn("[docusign-webhook] DOCUSIGN_HMAC_SECRET not set; rejecting");
    return new Response("webhook not configured", { status: 503 });
  }

  // DocuSign Connect can use header names like X-DocuSign-Signature-1 or
  // X-Authorization-Digest depending on config. Check both.
  const sig =
    req.headers.get("x-docusign-signature-1") ??
    req.headers.get("x-authorization-digest") ??
    null;

  const rawBody = await req.text();

  if (!verifyDocuSignSignature(rawBody, sig)) {
    await auditWebhookSignatureInvalid("docusign", req);
    return new Response("invalid signature", { status: 401 });
  }

  let body;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return new Response("invalid json", { status: 400 });
  }

  const parsed = PayloadSchema.safeParse(body);
  if (!parsed.success) {
    // eslint-disable-next-line no-console
    console.warn("[docusign-webhook] schema rejected:", parsed.error.issues[0]?.message);
    return NextResponse.json({ ok: false, reason: "schema_rejected" });
  }

  // Replay protection — dedupe on (envelopeId, event).
  const eventKey = `${parsed.data.data.envelopeId}:${parsed.data.event}`;
  const fresh = await claimWebhook("docusign", eventKey);
  if (!fresh) {
    await auditWebhookReplay("docusign", req, eventKey);
    return NextResponse.json({ ok: true, reason: "duplicate" });
  }

  const mapped = mapEvent(parsed.data.event);
  if (!mapped) {
    // Unknown event — log and 200 so DocuSign doesn't retry.
    return NextResponse.json({ ok: false, reason: "unhandled_event" });
  }

  const signerEmail = parsed.data.data.envelopeSummary?.recipients?.signers[0]?.email;
  if (!signerEmail) {
    return NextResponse.json({ ok: false, reason: "missing_signer_email" });
  }

  const result = await applyDocuSignWebhook({
    envelopeId: parsed.data.data.envelopeId,
    signerEmail,
    event: mapped,
    signedAt:
      parsed.data.data.envelopeSummary?.completedDateTime ?? null,
  });

  if (!result.ok) {
    // eslint-disable-next-line no-console
    console.warn(
      "[docusign-webhook] apply failed:",
      result.reason,
      "error" in result ? result.error : "",
    );
    return NextResponse.json({ ok: false, reason: result.reason });
  }

  // GAP-D3 closure (DocuSign side): notify Steven when SOW is signed so he
  // can immediately verify Stripe payment + send the intake.
  if (mapped === "envelope_completed") {
    await notifySigned(result.engagementId);
  }

  return NextResponse.json({
    ok: true,
    engagementId: result.engagementId,
    transition: `${result.previousStatus} → ${result.newStatus}`,
  });
}

async function notifySigned(engagementId: string): Promise<void> {
  const sb = getServiceClient();
  if (!sb) return;
  const { data: eng } = await sb
    .from("engagements")
    .select("engagement_ref, client_legal_name, client_email")
    .eq("id", engagementId)
    .maybeSingle();
  if (!eng) return;

  await sendInternalAlert({
    subject: `✍️ SOW signed — ${eng.client_legal_name}`,
    bodyHtml: `
      <p><strong>${escapeHtmlDS(eng.client_legal_name as string)}</strong> just signed the SOW (<code>${escapeHtmlDS(eng.engagement_ref as string)}</code>).</p>
      <p><strong>Next:</strong> verify Stripe payment cleared (or that the invoice is sent). Once paid, the playbook kickoff sequence starts.</p>
      <p><a href="https://loucels.com/admin/engagement/${engagementId}">Open in admin</a></p>
    `,
  });
}

function escapeHtmlDS(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
