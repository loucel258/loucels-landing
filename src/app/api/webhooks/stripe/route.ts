import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { applyStripeWebhook } from "@/lib/engagements/engagements";
import { sendInternalAlert } from "@/lib/notify/resend";
import { getServiceClient } from "@/lib/audit/client";
import { rejectIfTooLarge } from "@/lib/http/body-guard";
import { claimWebhook } from "@/lib/webhooks/dedupe";
import { auditWebhookSignatureInvalid, auditWebhookReplay } from "@/lib/webhooks/audit";

const MAX_WEBHOOK_BYTES = 64 * 1024;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Stripe webhook receiver.
 *
 * Closes GAP-D3 (manual Stripe correlation). Stripe signs each event with
 * HMAC-SHA256; we verify and transition the engagement.
 *
 * Setup (Steven, one-time):
 *   1. Stripe Dashboard → Developers → Webhooks → Add endpoint
 *   2. URL: https://loucels.com/api/webhooks/stripe
 *   3. Events to send: payment_intent.succeeded, payment_intent.payment_failed,
 *      checkout.session.completed (in case Payment Link is used vs Invoice)
 *   4. Copy the signing secret (starts with whsec_) into Vercel env as
 *      STRIPE_WEBHOOK_SECRET
 *
 * Note: we intentionally don't use the stripe SDK to avoid adding a 1MB
 * dep just for signature verification — we implement Stripe's signing
 * scheme by hand. See:
 * https://stripe.com/docs/webhooks/signatures#manually-construct-an-event
 *
 * Idempotency: Stripe retries on 5xx. `applyStripeWebhook` matches by
 * payment_intent_id first, so duplicate delivery is a safe no-op.
 */

const STRIPE_TIMESTAMP_TOLERANCE_SEC = 300;

function verifyStripeSignature(rawBody: string, sigHeader: string | null): boolean {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret || !sigHeader) return false;

  // Stripe signature header format:
  //   t=<timestamp>,v1=<hex_signature>,v1=<...>
  const parts = sigHeader.split(",");
  const timestamp = parts.find((p) => p.startsWith("t="))?.slice(2);
  const v1Sigs = parts.filter((p) => p.startsWith("v1=")).map((p) => p.slice(3));
  if (!timestamp || v1Sigs.length === 0) return false;

  // Replay protection: reject events older than 5 min (matches Stripe SDK).
  const tsNum = Number.parseInt(timestamp, 10);
  if (!Number.isFinite(tsNum)) return false;
  const drift = Math.abs(Math.floor(Date.now() / 1000) - tsNum);
  if (drift > STRIPE_TIMESTAMP_TOLERANCE_SEC) return false;

  const signedPayload = `${timestamp}.${rawBody}`;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(signedPayload, "utf-8")
    .digest("hex");

  return v1Sigs.some((sig) => {
    try {
      return crypto.timingSafeEqual(
        Buffer.from(expected, "hex"),
        Buffer.from(sig, "hex"),
      );
    } catch {
      return false;
    }
  });
}

type StripeEvent = {
  id: string;
  type: string;
  data: {
    object: {
      id: string;
      amount?: number;
      amount_received?: number;
      amount_total?: number;
      created?: number;
      receipt_email?: string;
      customer_email?: string;
      customer_details?: { email?: string };
      // Payment Intents
      latest_charge?: string;
      // Checkout Sessions wrapping a Payment Intent
      payment_intent?: string;
    };
  };
};

export async function POST(req: Request): Promise<Response> {
  const tooLarge = rejectIfTooLarge(req, MAX_WEBHOOK_BYTES);
  if (tooLarge) return tooLarge;

  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    // eslint-disable-next-line no-console
    console.warn("[stripe-webhook] STRIPE_WEBHOOK_SECRET not set; rejecting");
    return new Response("webhook not configured", { status: 503 });
  }

  const sig = req.headers.get("stripe-signature");
  const rawBody = await req.text();

  if (!verifyStripeSignature(rawBody, sig)) {
    await auditWebhookSignatureInvalid("stripe", req);
    return new Response("invalid signature", { status: 401 });
  }

  let event: StripeEvent;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return new Response("invalid json", { status: 400 });
  }

  // Replay protection (defense in depth — timestamp tolerance already
  // rejects events > 5 min old). Dedupe on Stripe event id.
  if (event.id) {
    const fresh = await claimWebhook("stripe", event.id);
    if (!fresh) {
      await auditWebhookReplay("stripe", req, event.id);
      return NextResponse.json({ ok: true, reason: "duplicate" });
    }
  }

  const obj = event.data?.object;
  if (!obj) {
    return NextResponse.json({ ok: false, reason: "no_object" });
  }

  // Resolve payment_intent_id consistently across event types
  const paymentIntentId =
    event.type === "checkout.session.completed"
      ? obj.payment_intent ?? obj.id
      : obj.id;

  // Customer email — varies by event shape
  const customerEmail =
    obj.customer_email ??
    obj.receipt_email ??
    obj.customer_details?.email ??
    null;

  if (!customerEmail || !paymentIntentId) {
    return NextResponse.json({
      ok: false,
      reason: "missing_email_or_intent",
    });
  }

  // Map event type → our internal event
  const mapped =
    event.type === "payment_intent.succeeded" ||
    event.type === "checkout.session.completed"
      ? "payment_succeeded"
      : event.type === "payment_intent.payment_failed"
        ? "payment_failed"
        : null;

  if (!mapped) {
    // Unhandled event — 200 so Stripe doesn't retry
    return NextResponse.json({ ok: true, ignored: event.type });
  }

  const amountCents =
    obj.amount_received ?? obj.amount_total ?? obj.amount ?? null;

  const paidAt = obj.created ? new Date(obj.created * 1000).toISOString() : null;

  const result = await applyStripeWebhook({
    paymentIntentId,
    customerEmail,
    event: mapped,
    amountCents,
    paidAt,
  });

  if (!result.ok) {
    // eslint-disable-next-line no-console
    console.warn(
      "[stripe-webhook] apply failed:",
      result.reason,
      "error" in result ? result.error : "",
    );
    return NextResponse.json({ ok: false, reason: result.reason });
  }

  // GAP-D3 closure: internal notification when payment succeeds. Lets Steven
  // know immediately to (a) send the intake questionnaire, (b) propose
  // kickoff slots, (c) scaffold the local engagement folder. Fail-silent
  // when Resend isn't configured.
  if (mapped === "payment_succeeded") {
    await notifyPayment(result.engagementId, customerEmail, amountCents);
  }

  return NextResponse.json({
    ok: true,
    engagementId: result.engagementId,
    transition: `${result.previousStatus} → ${result.newStatus}`,
  });
}

async function notifyPayment(
  engagementId: string,
  customerEmail: string,
  amountCents: number | null,
): Promise<void> {
  const sb = getServiceClient();
  if (!sb) return;

  // Pull the engagement details so the email is actionable, not just a number
  const { data: eng } = await sb
    .from("engagements")
    .select(
      "engagement_ref, client_legal_name, vertical, language, engagement_type",
    )
    .eq("id", engagementId)
    .maybeSingle();

  if (!eng) return;

  const amountStr = amountCents
    ? `$${(amountCents / 100).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`
    : "amount unknown";

  const refSlug = `${eng.engagement_ref}-${(eng.client_legal_name as string)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 40)}`;

  await sendInternalAlert({
    subject: `💰 Paid — ${eng.client_legal_name} (${amountStr})`,
    bodyHtml: `
      <p><strong>${escapeHtml(eng.client_legal_name as string)}</strong> just paid <strong>${amountStr}</strong>.</p>
      <ul>
        <li><strong>Engagement:</strong> <code>${escapeHtml(eng.engagement_ref as string)}</code></li>
        <li><strong>Type:</strong> ${escapeHtml(eng.engagement_type as string)}</li>
        <li><strong>Vertical:</strong> ${escapeHtml((eng.vertical as string) ?? "—")}</li>
        <li><strong>Language:</strong> ${escapeHtml((eng.language as string) ?? "en")}</li>
        <li><strong>Client email:</strong> <a href="mailto:${escapeHtml(customerEmail)}">${escapeHtml(customerEmail)}</a></li>
      </ul>
      <p><strong>Next actions:</strong></p>
      <ol>
        <li>Run locally (re-type the client name yourself — do NOT copy-paste it from this email):
          <br><code>bash gap-audit-kit/bin/new-engagement.sh "&lt;CLIENT NAME — type from the field above&gt;" ${escapeHtml((eng.vertical as string) ?? "other")} ${escapeHtml((eng.language as string) ?? "en")}</code>
        </li>
        <li>Send the intake questionnaire (Tally link) to the client</li>
        <li>Propose 3 kickoff slots via Cal.com</li>
      </ol>
      <p><a href="https://loucels.com/admin/engagement/${engagementId}">Open in admin</a></p>
    `,
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
