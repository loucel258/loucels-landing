import { NextResponse } from "next/server";
import { z } from "zod";
import { rateLimit } from "@/lib/rate-limit/limiter";
import { rejectIfTooLarge } from "@/lib/http/body-guard";
import { insertLead } from "@/lib/leads/leads";
import { sendInternalAlert } from "@/lib/notify/resend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Public contact-form endpoint — the low-commitment sibling of "Book a
 * call". A visitor who isn't ready to schedule a slot can still reach out.
 *
 * Lands in the `leads` table (source='contact_form') so it shows up in the
 * CRM + chat-pulse alongside every other lead, and fires an internal alert
 * so Steven sees it immediately. Public + unauthenticated, so it's guarded
 * with a body-size cap, a honeypot field, and a per-IP rate limit.
 */

const MAX_BODY_BYTES = 16 * 1024;

const ContactSchema = z.object({
  name: z.string().min(1).max(120),
  email: z.string().email().max(200),
  message: z.string().min(1).max(2000),
  business: z.string().max(160).optional(),
  phone: z.string().max(40).optional(),
  // Honeypot: a hidden field real users never fill. Accept any value at
  // the schema level so the handler can silently drop a filled one with a
  // fake success (a 400 here would teach a bot the field is validated).
  company_website: z.string().max(200).optional(),
});

function getClientIp(req: Request): string {
  const vercel = req.headers.get("x-vercel-forwarded-for");
  if (vercel) {
    const parts = vercel.split(",").map((p) => p.trim()).filter(Boolean);
    if (parts.length > 0) return parts[parts.length - 1]!;
  }
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) {
    const parts = fwd.split(",").map((p) => p.trim()).filter(Boolean);
    if (parts.length > 0) return parts[parts.length - 1]!;
  }
  return req.headers.get("x-real-ip") ?? "unknown";
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export async function POST(req: Request): Promise<Response> {
  const tooLarge = rejectIfTooLarge(req, MAX_BODY_BYTES);
  if (tooLarge) return tooLarge;

  const ip = getClientIp(req);
  // 3 submissions / 10 min per IP — generous for a human, hostile to a bot.
  const rl = await rateLimit(`contact:${ip}`, 3, 3 / 600);
  if (!rl.allowed) {
    return NextResponse.json(
      { ok: false, error: "rate_limited" },
      { status: 429, headers: { "retry-after": String(Math.ceil(rl.retryAfterSec)) } },
    );
  }

  let input;
  try {
    input = ContactSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  }

  // Honeypot tripped → pretend success so the bot doesn't learn, but drop it.
  if (input.company_website && input.company_website.length > 0) {
    return NextResponse.json({ ok: true });
  }

  // Fold optional context into the lead's notes-bearing fields. `reason`
  // carries the message; business/phone ride along in preferredWindow as a
  // compact context string (no schema change needed).
  const contextBits = [
    input.business ? `business: ${input.business}` : null,
    input.phone ? `phone: ${input.phone}` : null,
  ].filter(Boolean);

  const result = await insertLead({
    sessionId: `s_contact_${crypto.randomUUID().replace(/-/g, "").slice(0, 14)}`,
    auditRequestId: crypto.randomUUID(),
    name: input.name.slice(0, 120),
    email: input.email.toLowerCase(),
    reason: input.message.slice(0, 2000),
    preferredWindow: contextBits.length ? contextBits.join(" · ") : null,
    bookingLink: "[contact form]",
    source: "contact_form",
    ip,
  });

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: "save_failed" }, { status: 500 });
  }

  // Wake-up alert — best-effort, never blocks the user-facing success.
  await sendInternalAlert({
    subject: `[Contact form] ${input.name}`,
    bodyHtml: `
      <p>New contact-form submission from the landing.</p>
      <p><strong>Name:</strong> ${escapeHtml(input.name)}</p>
      <p><strong>Email:</strong> ${escapeHtml(input.email)}</p>
      ${input.business ? `<p><strong>Business:</strong> ${escapeHtml(input.business)}</p>` : ""}
      ${input.phone ? `<p><strong>Phone:</strong> ${escapeHtml(input.phone)}</p>` : ""}
      <p><strong>Message:</strong></p>
      <pre style="background:#f5f5f5;padding:12px;border-radius:6px;white-space:pre-wrap;font-family:inherit;">${escapeHtml(input.message)}</pre>
    `,
  });

  return NextResponse.json({ ok: true });
}
