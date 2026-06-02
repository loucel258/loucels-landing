import { NextResponse } from "next/server";
import { z } from "zod";
import { getClaudeClient } from "@/lib/ai/claude-client";
import { sanitize } from "@/lib/dlp/sanitizer";
import { rateLimit } from "@/lib/rate-limit/limiter";
import { buildSystemPrompt } from "@/lib/chat/system-prompt";
import { REQUEST_BOOKING_TOOL, handleRequestBooking } from "@/lib/chat/tools";
import { logChatEvent } from "@/lib/chat/observability";
import {
  auditAssistantReply,
  auditBookingOffered,
  auditChatFailed,
  auditPiiBlocked,
  auditUserMessage,
} from "@/lib/chat/audit";
import type { BookingPayload, ChatResponse } from "@/lib/chat/types";
import { isLocale } from "@/i18n/config";
import { siteConfig } from "@/lib/site-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Hard caps — first line of defense against abuse / cost runaway.
const MAX_USER_MESSAGE_CHARS = 2000;
const MAX_HISTORY_MESSAGES = 30;
const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-haiku-4-5-20251001";
const MAX_TOKENS = 1024;

// Rate limit: 30 messages / hour per IP (burst of 8). Process-local — see
// lib/rate-limit/limiter.ts for caveats on multi-instance deploys.
const RATE_CAPACITY = 8;
const RATE_REFILL_PER_SEC = 30 / 3600; // 30/hour

const ChatRequestSchema = z.object({
  locale: z.string().refine(isLocale, "invalid locale"),
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1).max(MAX_USER_MESSAGE_CHARS),
      }),
    )
    .min(1)
    .max(MAX_HISTORY_MESSAGES),
  sessionId: z.string().min(8).max(64).optional(),
});

const BookingInputSchema = z.object({
  name: z.string().min(1).max(120),
  email: z.string().email().max(200),
  reason: z.string().min(1).max(500),
  preferredWindow: z.string().max(200).optional(),
});

// PII types that, if found in user input, mean we refuse to forward to the
// model and ask the visitor to remove. (Names/emails are fine — those go via
// the booking tool intentionally.)
const HIGH_RISK_PII = new Set([
  "SSN",
  "ITIN",
  "EIN",
  "CREDIT_CARD",
  "BANK_ACCOUNT",
  "API_KEY",
  "AWS_KEY",
  "ANTHROPIC_KEY",
]);

function getClientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  const real = req.headers.get("x-real-ip");
  if (real) return real;
  return "unknown";
}

function originAllowed(req: Request): boolean {
  // CSRF defense: accept the request only if Origin matches the URL we are
  // serving on. This naturally covers localhost dev, Vercel preview deploys,
  // and production — no hardcoded list. Cross-site POST from evil.com is
  // rejected because its Origin won't match our host.
  const origin = req.headers.get("origin");
  if (!origin) {
    // No Origin header on POST is unusual (browsers always set it). Allow in
    // non-production to support server-rendered curl tests.
    return process.env.NODE_ENV !== "production";
  }
  try {
    const got = new URL(origin).origin;
    const same = new URL(req.url).origin;
    if (got === same) return true;
    // Also honor an explicit production site URL when it differs from req.url
    // (e.g., request received behind a proxy that rewrites the host).
    if (got === new URL(siteConfig.url).origin) return true;
    return false;
  } catch {
    return false;
  }
}

function safeError(reason: ChatErrorReason): NextResponse<ChatResponse> {
  // Single funnel for all errors so we never leak internals (no stack traces,
  // no SDK error messages). Client gets a stable code; we log the detail.
  const status = ERROR_STATUS[reason] ?? 500;
  return NextResponse.json({ ok: false, error: reason }, { status });
}

type ChatErrorReason =
  | "bad_request"
  | "rate_limited"
  | "origin_blocked"
  | "input_too_long"
  | "pii_blocked"
  | "chat_unavailable"
  | "chat_failed";

const ERROR_STATUS: Record<ChatErrorReason, number> = {
  bad_request: 400,
  rate_limited: 429,
  origin_blocked: 403,
  input_too_long: 413,
  pii_blocked: 422,
  chat_unavailable: 503,
  chat_failed: 502,
};

export async function POST(req: Request): Promise<NextResponse<ChatResponse>> {
  const ip = getClientIp(req);
  const requestId = crypto.randomUUID();

  // 1) Origin check (cheap CSRF defense)
  if (!originAllowed(req)) {
    logChatEvent({ kind: "origin_blocked", ip });
    return safeError("origin_blocked");
  }

  // 2) Rate limit per IP
  const rl = rateLimit(`chat:${ip}`, RATE_CAPACITY, RATE_REFILL_PER_SEC);
  if (!rl.allowed) {
    logChatEvent({ kind: "rate_limited", ip, retryAfterSec: rl.retryAfterSec });
    return NextResponse.json(
      { ok: false, error: "rate_limited" },
      {
        status: 429,
        headers: { "retry-after": String(Math.ceil(rl.retryAfterSec)) },
      },
    );
  }

  // 3) Parse + validate the request body
  let parsed;
  try {
    parsed = ChatRequestSchema.parse(await req.json());
  } catch {
    logChatEvent({ kind: "bad_request", ip });
    return safeError("bad_request");
  }

  const lastUserMessage = [...parsed.messages]
    .reverse()
    .find((m) => m.role === "user");
  if (!lastUserMessage) return safeError("bad_request");

  // 4) Audit context — sessionId is required from this point on for the
  // per-session audit RPC to be useful. We fall back to a per-request id
  // if the client did not send one (very rare; only first-ever request
  // before sessionStorage warmed up).
  const sessionId = parsed.sessionId ?? `s_anon_${requestId.replace(/-/g, "").slice(0, 14)}`;
  const auditBase = { sessionId, requestId, ip };

  // 5) Rate-limit audit (DENY) — fires after rl block above; we get here
  // only when rl.allowed is true, so this never runs for blocked traffic.
  // But if we want a permanent record of blocked traffic too, wire it
  // before the early return above. For now, blocked traffic is logged
  // only via console (cheaper). Promote later if compliance asks.

  // 6) PII pre-check on the latest user message
  const dlp = sanitize(lastUserMessage.content);
  const hasHighRiskPII = dlp.redactions.some((r) =>
    HIGH_RISK_PII.has(String(r.type).toUpperCase()),
  );
  if (hasHighRiskPII) {
    const piiTypes = dlp.redactions.map((r) => r.type);
    logChatEvent({
      kind: "pii_blocked",
      ip,
      sessionId,
      piiTypes,
    });
    // Permanent audit row: DENY / dlp_layer1
    await auditPiiBlocked(auditBase, { piiTypes, sanitizeResult: dlp });
    const refusal =
      parsed.locale === "es"
        ? "Detecté algo sensible en tu mensaje (parece un número de tarjeta, SSN o similar). Por favor no compartas eso aquí — para cualquier dato real lo manejaríamos en un canal seguro después de una llamada de discovery."
        : "I noticed something sensitive in your message (looks like a card number, SSN, or similar). Please don't share that here — for any real data we'd handle it in a secured channel after a discovery call.";
    return NextResponse.json({ ok: true, reply: refusal });
  }

  const client = getClaudeClient();
  if (!client) {
    logChatEvent({ kind: "chat_unavailable", ip, reason: "no_api_key" });
    return safeError("chat_unavailable");
  }

  const system = buildSystemPrompt(parsed.locale);

  logChatEvent({
    kind: "user_message",
    ip,
    sessionId,
    locale: parsed.locale,
    messageCount: parsed.messages.length,
    lastMessagePreview: lastUserMessage.content.slice(0, 80),
  });
  // Permanent audit row: ALLOW / chat / user_message (hash of sanitized text)
  await auditUserMessage(auditBase, {
    locale: parsed.locale,
    messageContent: lastUserMessage.content,
    sanitizeResult: dlp,
  });

  try {
    const first = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system,
      tools: [REQUEST_BOOKING_TOOL],
      messages: parsed.messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    });

    const toolUse = first.content.find(
      (block): block is Extract<typeof block, { type: "tool_use" }> =>
        block.type === "tool_use",
    );

    if (!toolUse || toolUse.name !== "request_booking") {
      const text = first.content
        .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      const reply = text || fallbackReply(parsed.locale);
      logChatEvent({
        kind: "assistant_reply",
        ip,
        sessionId,
        bookingOffered: false,
        replyPreview: reply.slice(0, 120),
      });
      await auditAssistantReply(auditBase, {
        replyContent: reply,
        bookingOffered: false,
        tokensIn: first.usage?.input_tokens ?? null,
        tokensOut: first.usage?.output_tokens ?? null,
      });
      return NextResponse.json({ ok: true, reply });
    }

    let booking: BookingPayload;
    try {
      booking = BookingInputSchema.parse(toolUse.input);
    } catch {
      return NextResponse.json({
        ok: true,
        reply: bookingRetryReply(parsed.locale),
      });
    }

    const { bookingLink, prefilledFor } = handleRequestBooking(booking);

    const followUp = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system,
      tools: [REQUEST_BOOKING_TOOL],
      messages: [
        ...parsed.messages.map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        })),
        { role: "assistant" as const, content: first.content },
        {
          role: "user" as const,
          content: [
            {
              type: "tool_result" as const,
              tool_use_id: toolUse.id,
              content: JSON.stringify({ bookingLink, prefilledFor }),
            },
          ],
        },
      ],
    });

    const followText = followUp.content
      .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    const reply = followText || bookingDefaultReply(parsed.locale, bookingLink);

    logChatEvent({
      kind: "booking_offered",
      ip,
      sessionId,
      name: booking.name,
      email: booking.email,
      reason: booking.reason,
    });
    // Two audit rows for a booking-bearing reply:
    //   1) the reply itself (assistant_reply, ALLOW, with token usage)
    //   2) the booking event (booking_offered, ALLOW, no PII persisted)
    await auditAssistantReply(auditBase, {
      replyContent: reply,
      bookingOffered: true,
      tokensIn: (first.usage?.input_tokens ?? 0) + (followUp.usage?.input_tokens ?? 0),
      tokensOut: (first.usage?.output_tokens ?? 0) + (followUp.usage?.output_tokens ?? 0),
    });
    await auditBookingOffered(auditBase, { reasonSummary: booking.reason });

    return NextResponse.json({
      ok: true,
      reply,
      bookingLink,
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    logChatEvent({
      kind: "chat_failed",
      ip,
      sessionId,
      error: errorMessage,
    });
    await auditChatFailed(auditBase, { error: errorMessage });
    return safeError("chat_failed");
  }
}

function fallbackReply(locale: "en" | "es"): string {
  return locale === "es"
    ? "Disculpa, no pude generar una respuesta. ¿Puedes reformular?"
    : "Sorry — I couldn't generate a reply. Could you rephrase?";
}

function bookingRetryReply(locale: "en" | "es"): string {
  return locale === "es"
    ? "Para enviarte el link necesito tu nombre y email. ¿Me los compartes?"
    : "To send you the link I need your name and email — could you share them?";
}

function bookingDefaultReply(locale: "en" | "es", link: string): string {
  return locale === "es"
    ? `Listo. Aquí está tu link:\n${link}`
    : `Here's your link:\n${link}`;
}
