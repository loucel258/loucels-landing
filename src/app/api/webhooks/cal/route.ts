import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { z } from "zod";
import { applyCalWebhook } from "@/lib/leads/leads";
import { rejectIfTooLarge } from "@/lib/http/body-guard";
import { claimWebhook } from "@/lib/webhooks/dedupe";
import { auditWebhookSignatureInvalid, auditWebhookReplay } from "@/lib/webhooks/audit";

const MAX_WEBHOOK_BYTES = 64 * 1024;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Cal.com webhook receiver.
 *
 * Closes the GAP-C1 gap: we used to log `booking_offered` in the audit chain
 * when the agent sent the link, but had no signal back about whether the
 * visitor actually completed the booking on Cal.com. Now Cal.com calls us
 * when BOOKING_CREATED / BOOKING_RESCHEDULED / BOOKING_CANCELLED fires, and
 * we transition the matching `leads` row.
 *
 * Setup (Steven, do once):
 *   1. Cal.com Dashboard → Settings → Developer → Webhooks
 *   2. Add webhook URL: https://loucellscore.com/api/webhooks/cal
 *   3. Select event triggers: BOOKING_CREATED, BOOKING_RESCHEDULED,
 *      BOOKING_CANCELLED
 *   4. Set a webhook secret (any strong random string); copy it into your
 *      Vercel env vars as CAL_WEBHOOK_SECRET
 *   5. Save. Cal.com will start signing requests with HMAC-SHA256.
 *
 * Security:
 *   - HMAC signature verification using CAL_WEBHOOK_SECRET (Cal.com sends
 *     it in the `X-Cal-Signature-256` header per their docs as of 2025).
 *   - If the env var is missing, the route returns 503 — fails closed.
 *   - Body parsing is done after signature verification to avoid leaking
 *     compute on unsigned requests.
 *
 * Idempotency:
 *   Cal.com may retry on transient failures. The handler tolerates this:
 *   `applyCalWebhook` matches by `cal_event_id` first, so re-processing
 *   the same event just updates the same row with the same status.
 */

const PayloadSchema = z.object({
  triggerEvent: z.enum([
    "BOOKING_CREATED",
    "BOOKING_RESCHEDULED",
    "BOOKING_CANCELLED",
  ]),
  payload: z.object({
    uid: z.string().min(1),                      // Cal.com's event UID
    startTime: z.string().optional(),             // ISO 8601
    attendees: z
      .array(
        z.object({
          email: z.string().email(),
          name: z.string().optional(),
        }),
      )
      .min(1),
  }),
});

function verifyCalSignature(rawBody: string, signature: string | null): boolean {
  const secret = process.env.CAL_WEBHOOK_SECRET;
  if (!secret || !signature) return false;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(rawBody, "utf-8")
    .digest("hex");
  // Cal.com sends `X-Cal-Signature-256: <hex>` (no `sha256=` prefix as of
  // 2025-era docs). Constant-time compare.
  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected, "hex"),
      Buffer.from(signature, "hex"),
    );
  } catch {
    return false;
  }
}

export async function POST(req: Request): Promise<Response> {
  const tooLarge = rejectIfTooLarge(req, MAX_WEBHOOK_BYTES);
  if (tooLarge) return tooLarge;

  if (!process.env.CAL_WEBHOOK_SECRET) {
    // Fail closed when the secret isn't configured — better to drop a webhook
    // than to write unsigned events into the leads table.
    // eslint-disable-next-line no-console
    console.warn("[cal-webhook] CAL_WEBHOOK_SECRET not set; rejecting");
    return new Response("webhook not configured", { status: 503 });
  }

  const signature = req.headers.get("x-cal-signature-256");
  const rawBody = await req.text();

  if (!verifyCalSignature(rawBody, signature)) {
    // eslint-disable-next-line no-console
    console.warn("[cal-webhook] signature mismatch");
    await auditWebhookSignatureInvalid("cal", req);
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
    console.warn(
      "[cal-webhook] schema rejected:",
      parsed.error.issues[0]?.message,
    );
    // Return 200 — we don't want Cal.com retrying a payload we'll never
    // accept. Logging is enough.
    return NextResponse.json({ ok: false, reason: "schema_rejected" });
  }

  const { triggerEvent, payload } = parsed.data;

  // Replay protection — Cal does not stamp a usable timestamp, so we dedupe
  // on (event uid, triggerEvent). A reschedule has the same uid as the
  // original booking but a different trigger, hence both fields.
  const eventKey = `${payload.uid}:${triggerEvent}`;
  const fresh = await claimWebhook("cal", eventKey);
  if (!fresh) {
    await auditWebhookReplay("cal", req, eventKey);
    return NextResponse.json({ ok: true, reason: "duplicate" });
  }

  const attendeeEmail = payload.attendees[0]!.email;

  const result = await applyCalWebhook({
    triggerEvent,
    email: attendeeEmail,
    calEventId: payload.uid,
    slotIso: payload.startTime ?? null,
  });

  if (!result.ok) {
    // eslint-disable-next-line no-console
    console.warn(
      "[cal-webhook] apply failed:",
      result.reason,
      "error" in result ? result.error : "",
    );
    // Still return 200 so Cal.com doesn't retry indefinitely on a "no match"
    // (some bookings happen outside the chat flow — those don't have a lead
    // row to update). We log; Steven can audit logs to find orphan bookings.
    return NextResponse.json({ ok: false, reason: result.reason });
  }

  return NextResponse.json({
    ok: true,
    leadId: result.leadId,
    transition: `${result.previousStatus} → ${triggerEvent}`,
  });
}
