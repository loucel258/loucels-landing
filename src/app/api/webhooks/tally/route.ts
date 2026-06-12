import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { z } from "zod";
import { applyTallyWebhook } from "@/lib/engagements/engagements";
import { sendInternalAlert } from "@/lib/notify/resend";
import { getServiceClient } from "@/lib/audit/client";
import { rejectIfTooLarge } from "@/lib/http/body-guard";
import { claimWebhook } from "@/lib/webhooks/dedupe";
import { auditWebhookSignatureInvalid, auditWebhookReplay } from "@/lib/webhooks/audit";

const MAX_WEBHOOK_BYTES = 64 * 1024;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Tally form webhook receiver.
 *
 * Closes GAP-D5 (Tally responses route undefined). The intake questionnaire
 * is hosted on Tally; this receiver transitions the matching engagement
 * to 'intake_received' state.
 *
 * Setup (Steven, one-time):
 *   1. Tally form → Integrations → Webhooks → Add webhook
 *   2. URL: https://loucellscore.com/api/webhooks/tally
 *   3. Set signing secret in env: TALLY_WEBHOOK_SECRET
 *      (Tally signs with HMAC-SHA256, header: tally-signature)
 *
 * Note: Tally's webhook payload shape varies by form. We look for the
 * respondent's email via a few common field labels (email, e-mail, correo)
 * and fall back to a header field if present.
 *
 * Idempotency: matching on submissionId — duplicate delivery is a no-op.
 */

const TallyFieldSchema = z.object({
  key: z.string().optional(),
  label: z.string().optional(),
  type: z.string().optional(),
  value: z.unknown(),
});

const PayloadSchema = z.object({
  eventId: z.string().optional(),
  eventType: z.string().optional(),
  createdAt: z.string().optional(),
  data: z.object({
    submissionId: z.string().optional(),
    respondentId: z.string().optional(),
    formId: z.string().optional(),
    formName: z.string().optional(),
    createdAt: z.string().optional(),
    fields: z.array(TallyFieldSchema).optional(),
  }),
});

function verifyTallySignature(rawBody: string, sigHeader: string | null): boolean {
  const secret = process.env.TALLY_WEBHOOK_SECRET;
  if (!secret || !sigHeader) return false;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(rawBody, "utf-8")
    .digest("base64");
  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected, "base64"),
      Buffer.from(sigHeader, "base64"),
    );
  } catch {
    return false;
  }
}

function extractEmailFromFields(
  fields: Array<{ key?: string; label?: string; type?: string; value: unknown }> | undefined,
): string | null {
  if (!fields) return null;
  // Try by type first
  for (const f of fields) {
    if (f.type?.toLowerCase().includes("email") && typeof f.value === "string") {
      return f.value;
    }
  }
  // Try by label
  for (const f of fields) {
    const label = (f.label ?? f.key ?? "").toLowerCase();
    if (
      (label.includes("email") || label.includes("e-mail") || label.includes("correo")) &&
      typeof f.value === "string"
    ) {
      return f.value;
    }
  }
  return null;
}

export async function POST(req: Request): Promise<Response> {
  const tooLarge = rejectIfTooLarge(req, MAX_WEBHOOK_BYTES);
  if (tooLarge) return tooLarge;

  if (!process.env.TALLY_WEBHOOK_SECRET) {
    // eslint-disable-next-line no-console
    console.warn("[tally-webhook] TALLY_WEBHOOK_SECRET not set; rejecting");
    return new Response("webhook not configured", { status: 503 });
  }

  const sig = req.headers.get("tally-signature");
  const rawBody = await req.text();

  if (!verifyTallySignature(rawBody, sig)) {
    await auditWebhookSignatureInvalid("tally", req);
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
    console.warn("[tally-webhook] schema rejected:", parsed.error.issues[0]?.message);
    return NextResponse.json({ ok: false, reason: "schema_rejected" });
  }

  const submissionId =
    parsed.data.data.submissionId ??
    parsed.data.eventId ??
    crypto.randomUUID();

  const fresh = await claimWebhook("tally", submissionId);
  if (!fresh) {
    await auditWebhookReplay("tally", req, submissionId);
    return NextResponse.json({ ok: true, reason: "duplicate" });
  }

  const email = extractEmailFromFields(parsed.data.data.fields);
  if (!email) {
    return NextResponse.json({ ok: false, reason: "no_email_in_payload" });
  }

  const result = await applyTallyWebhook({
    submissionId,
    respondentEmail: email,
    receivedAt:
      parsed.data.data.createdAt ?? parsed.data.createdAt ?? null,
  });

  if (!result.ok) {
    // eslint-disable-next-line no-console
    console.warn(
      "[tally-webhook] apply failed:",
      result.reason,
      "error" in result ? result.error : "",
    );
    return NextResponse.json({ ok: false, reason: result.reason });
  }

  // GAP-D3 closure (Tally side): notify when intake arrives so Steven knows
  // to start day-3 audit work (or schedule kickoff if not yet held).
  await notifyIntake(result.engagementId);

  return NextResponse.json({
    ok: true,
    engagementId: result.engagementId,
    transition: `${result.previousStatus} → ${result.newStatus}`,
  });
}

async function notifyIntake(engagementId: string): Promise<void> {
  const sb = getServiceClient();
  if (!sb) return;
  const { data: eng } = await sb
    .from("engagements")
    .select("engagement_ref, client_legal_name")
    .eq("id", engagementId)
    .maybeSingle();
  if (!eng) return;

  await sendInternalAlert({
    subject: `📝 Intake received — ${eng.client_legal_name}`,
    bodyHtml: `
      <p><strong>${escapeHtmlT(eng.client_legal_name as string)}</strong> submitted the intake questionnaire (<code>${escapeHtmlT(eng.engagement_ref as string)}</code>).</p>
      <p><strong>Next:</strong> review answers, prep kickoff agenda, send access checklist if not already sent.</p>
      <p><a href="https://loucellscore.com/admin/engagement/${engagementId}">Open in admin</a></p>
    `,
  });
}

function escapeHtmlT(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
