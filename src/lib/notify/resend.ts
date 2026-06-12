import "server-only";
import { timingSafeEqual } from "node:crypto";

/**
 * Minimal Resend client over fetch — no SDK dep added.
 *
 * Fails closed when RESEND_API_KEY is unset (returns ok:false). This lets
 * cron jobs run safely during pre-launch without breaking; emails just
 * don't go out. Once Steven adds the key, sends start flowing.
 */

const RESEND_API_URL = "https://api.resend.com/emails";
const FROM_DEFAULT = "Steven @ Loucells Core <contact@loucellscore.com>";
// Where internal alerts (HITL, escalations, budget) land. Env-overridable
// because the contact@ MAILBOX doesn't exist yet — sending FROM it only
// needs domain verification, but receiving needs a real inbox. Until the
// mailbox is provisioned, point this at Steven's Gmail via Vercel env.
const INTERNAL_INBOX = process.env.INTERNAL_ALERT_INBOX ?? "contact@loucellscore.com";

export type SendEmailInput = {
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  from?: string;
  replyTo?: string;
};

export type SendEmailResult =
  | { ok: true; id: string }
  | { ok: false; reason: "no_api_key" | "send_failed"; error?: string };

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { ok: false, reason: "no_api_key" };

  const payload: Record<string, unknown> = {
    from: input.from ?? FROM_DEFAULT,
    to: Array.isArray(input.to) ? input.to : [input.to],
    subject: input.subject,
  };
  if (input.html) payload.html = input.html;
  if (input.text) payload.text = input.text;
  if (input.replyTo) payload.reply_to = input.replyTo;

  try {
    const res = await fetch(RESEND_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errBody = await res.text();
      return {
        ok: false,
        reason: "send_failed",
        error: `${res.status}: ${errBody.slice(0, 200)}`,
      };
    }

    const data = (await res.json()) as { id?: string };
    return { ok: true, id: data.id ?? "unknown" };
  } catch (e) {
    return {
      ok: false,
      reason: "send_failed",
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export async function sendInternalAlert(args: {
  subject: string;
  bodyHtml: string;
  bodyText?: string;
}): Promise<SendEmailResult> {
  return sendEmail({
    to: INTERNAL_INBOX,
    subject: `[Loucells Core ops] ${args.subject}`,
    html: args.bodyHtml,
    text: args.bodyText ?? stripHtml(args.bodyHtml),
  });
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

/**
 * Verifies the Vercel cron secret on incoming cron requests. Vercel adds
 * `Authorization: Bearer <CRON_SECRET>` automatically when invoking a
 * route registered in vercel.json. Defends against random POSTs.
 *
 * Returns true when:
 *   - CRON_SECRET env var is set AND the header matches
 *   - OR we're in local dev (NODE_ENV !== "production")
 *
 * Returns false otherwise — caller should respond 401.
 */
export function verifyCronAuth(req: Request): boolean {
  if (process.env.NODE_ENV !== "production") return true;
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  const a = Buffer.from(auth);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
