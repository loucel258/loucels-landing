import { NextResponse } from "next/server";
import { z } from "zod";
import { getClaudeClient } from "@/lib/ai/claude-client";
import { sanitize } from "@/lib/dlp/sanitizer";
import { sanitizeWithLLM } from "@/lib/dlp/sanitizer-llm";
import { rateLimit } from "@/lib/rate-limit/limiter";
import { rejectIfTooLarge } from "@/lib/http/body-guard";
import { sha256Hex } from "@/lib/crypto/hash";
import { writeAuditEntry } from "@/lib/audit/writer";
import { getServiceClient } from "@/lib/audit/client";
import { persistTurn } from "@/lib/portal/transcripts";
import { resolveAgent, originAllowedForAgent, type ResolvedAgent } from "@/lib/agents/resolver";
import { buildAgentSystemPrompt } from "@/lib/agents/safety-prompt";
import { isBudgetExhausted, recordUsage } from "@/lib/agents/budget";
import {
  REQUEST_BOOKING_TOOL,
  ESCALATE_TO_HUMAN_TOOL,
  handleRequestBooking,
  handleEscalateToHuman,
} from "@/lib/chat/tools";
import { insertLead } from "@/lib/leads/leads";
import type { BookingPayload, ChatResponse } from "@/lib/chat/types";
import { isLocale } from "@/i18n/config";
import type Anthropic from "@anthropic-ai/sdk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 32 * 1024;
const RATE_CAPACITY = 10;
const RATE_REFILL_PER_SEC = 0.2;
// Global per-slug ceiling. Caps blast radius from an attacker rotating
// IPs across a botnet against a single tenant. 60 req/min ≈ 1 req/sec
// sustained per agent — well above legitimate human chat traffic.
const GLOBAL_SLUG_CAPACITY = 60;
const GLOBAL_SLUG_REFILL_PER_SEC = 1;

const ChatRequestSchema = z.object({
  sessionId: z.string().min(8).max(64).optional(),
  locale: z.string().refine(isLocale).default("en"),
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1).max(4000),
      }),
    )
    .min(1)
    .max(40),
});

const BookingInputSchema = z.object({
  name: z.string().min(1).max(120),
  email: z.string().email().max(200),
  reason: z.string().min(1).max(500),
  preferredWindow: z.string().max(200).optional(),
});

const EscalationInputSchema = z.object({
  reason: z.enum([
    "out_of_scope",
    "sensitive_topic",
    "frustrated_visitor",
    "ambiguous_high_stakes",
    "agent_uncertain",
  ]),
  summary: z.string().min(1).max(500),
  name: z.string().max(120).optional(),
  email: z.string().email().max(200).optional(),
});

const HIGH_RISK_PII = new Set([
  "SSN", "ITIN", "EIN", "CREDIT_CARD", "BANK_ACCOUNT",
  "API_KEY", "AWS_KEY", "ANTHROPIC_KEY",
]);

const TOOL_LOOKUP: Record<string, Anthropic.Tool> = {
  request_booking: REQUEST_BOOKING_TOOL,
  escalate_to_human: ESCALATE_TO_HUMAN_TOOL,
};

type ErrorReason =
  | "bad_request"
  | "rate_limited"
  | "origin_blocked"
  | "input_too_long"
  | "pii_blocked"
  | "agent_not_found"
  | "agent_not_live"
  | "agent_paused"
  | "chat_unavailable"
  | "chat_failed";

const ERROR_STATUS: Record<ErrorReason, number> = {
  bad_request: 400,
  rate_limited: 429,
  origin_blocked: 403,
  input_too_long: 413,
  pii_blocked: 422,
  agent_not_found: 404,
  agent_not_live: 503,
  agent_paused: 503,
  chat_unavailable: 503,
  chat_failed: 502,
};

function safeError(
  reason: ErrorReason,
  cors?: Record<string, string>,
): NextResponse<ChatResponse> {
  // Cast is necessary because ChatResponse's error union doesn't include
  // every multi-tenant-specific code. The widget renders unknown codes as
  // a generic "we couldn't reach the agent" message — that's intentional.
  return NextResponse.json(
    { ok: false, error: reason as ChatResponse extends { error: infer E } ? E : never },
    { status: ERROR_STATUS[reason], headers: cors },
  );
}

/**
 * Build per-tenant CORS headers for a request that has already cleared
 * `originAllowedForAgent`. We echo the specific origin (never `*`) so
 * each response is scoped to exactly one tenant. `Vary: Origin` is
 * mandatory so any CDN / Next data cache cannot serve one tenant's
 * response to another. No `Allow-Credentials` — the widget is a public,
 * cookieless endpoint.
 */
function corsHeadersFor(req: Request): Record<string, string> {
  const origin = req.headers.get("origin");
  if (!origin) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Vary": "Origin",
  };
}

const PREFLIGHT_BASE: Record<string, string> = {
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "600",
};

/**
 * CORS preflight. We resolve the agent and re-run the origin check so
 * the browser only caches a permissive answer for origins that the
 * tenant has explicitly allowed. Anything else gets a bare 204 with no
 * CORS headers — the browser will then block the real POST.
 */
export async function OPTIONS(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await params;
  const agent = await resolveAgent(slug);
  if (!agent || agent.status !== "live") {
    return new Response(null, { status: 204, headers: { "Vary": "Origin" } });
  }
  if (!originAllowedForAgent(req, agent)) {
    return new Response(null, { status: 204, headers: { "Vary": "Origin" } });
  }
  const origin = req.headers.get("origin")!;
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": origin,
      ...PREFLIGHT_BASE,
      "Vary": "Origin",
    },
  });
}

function getClientIp(req: Request): string {
  // Prefer Vercel's authoritative client IP header — it can't be spoofed
  // by the caller because Vercel sets it at the edge.
  const vercel = req.headers.get("x-vercel-forwarded-for");
  if (vercel) {
    const parts = vercel.split(",").map((p) => p.trim()).filter(Boolean);
    if (parts.length > 0) return parts[parts.length - 1]!;
  }
  // Fall back to the closest hop in standard XFF. The LAST entry is the
  // value our proxy observed; the FIRST is attacker-controlled.
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) {
    const parts = fwd.split(",").map((p) => p.trim()).filter(Boolean);
    if (parts.length > 0) return parts[parts.length - 1]!;
  }
  return req.headers.get("x-real-ip") ?? "unknown";
}

function normalizeIp(ip: string | null): string | null {
  if (!ip) return null;
  const t = ip.trim();
  if (!t || t === "unknown") return null;
  return t;
}

/**
 * Audit helper. We hash any text at the call site and pass only the hash
 * — never the plaintext — so the writer cannot accidentally log or
 * persist conversation content. The schema's `plain_prompt_for_hash`
 * convenience field is intentionally NOT used here.
 */
async function audit(
  agent: ResolvedAgent,
  sessionId: string,
  ip: string,
  fields: {
    decision: "ALLOW" | "DENY";
    blocked_by?: string | null;
    reason?: string;
    /** Pre-computed SHA-256 hex of the text being attested to. Empty = no text in this event. */
    contentHash?: string;
    tokensIn?: number | null;
    tokensOut?: number | null;
    redactionCount?: number;
  },
): Promise<void> {
  try {
    await writeAuditEntry({
      request_id: crypto.randomUUID(),
      workspace_id: agent.workspaceId,
      user_id: sessionId,
      role: "visitor",
      ip_address: normalizeIp(ip),
      source: "agent",
      sanitized_prompt_hash: fields.contentHash ?? "",
      decision: fields.decision,
      blocked_by: fields.blocked_by ?? null,
      reason: fields.reason ?? "",
      token_usage_in: fields.tokensIn ?? null,
      token_usage_out: fields.tokensOut ?? null,
      redaction_count: fields.redactionCount,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[agent-chat] audit write failed:", err);
  }
}

async function isSessionPaused(agentEngagementId: string, sessionId: string): Promise<boolean> {
  const sb = getServiceClient();
  if (!sb) return false;
  const { data } = await sb
    .from("paused_sessions")
    .select("session_id")
    .eq("session_id", sessionId)
    .eq("engagement_id", agentEngagementId)
    .limit(1)
    .maybeSingle();
  return !!data;
}

/**
 * Final pause gate. Called right before we ship the assistant's reply to
 * the visitor. If the owner clicked "take over" between our initial
 * pause check and now (Claude calls take seconds), suppress the agent's
 * reply and log the interrupt so the audit chain reflects the race.
 */
async function checkPauseBeforeReply(
  agent: ResolvedAgent,
  sessionId: string,
  ip: string,
  locale: "en" | "es",
  cors: Record<string, string>,
): Promise<NextResponse | null> {
  if (!(await isSessionPaused(agent.engagementId, sessionId))) return null;
  await audit(agent, sessionId, ip, {
    decision: "DENY",
    blocked_by: "session_paused",
    reason: "owner_take_over:after_completion",
  });
  const standdown = locale === "es"
    ? "Un miembro de nuestro equipo está respondiendo personalmente esta conversación. Por favor revisa tu correo."
    : "A member of our team is responding to this conversation directly. Please check your email.";
  return NextResponse.json({ ok: true, reply: standdown }, { headers: cors });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  // 0. Body-size guard before reading anything
  const tooLarge = rejectIfTooLarge(req, MAX_BODY_BYTES);
  if (tooLarge) return tooLarge;

  const { slug } = await params;
  const ip = getClientIp(req);
  const preSession = `s_pre_${crypto.randomUUID().replace(/-/g, "").slice(0, 14)}`;

  // 1. Resolve agent
  const agent = await resolveAgent(slug);
  if (!agent) {
    return safeError("agent_not_found");
  }
  if (agent.status !== "live") {
    // Don't leak shadow/uat/designing state to public callers
    return safeError("agent_not_found");
  }

  // 2. Origin check
  if (!originAllowedForAgent(req, agent)) {
    await audit(agent, preSession, ip, {
      decision: "DENY",
      blocked_by: "origin_blocked",
      reason: req.headers.get("origin") ?? "(no origin)",
    });
    // No CORS headers — browser will surface as CORS error, which is the
    // right signal for an embed installed on an un-allowlisted domain.
    return safeError("origin_blocked");
  }

  // Origin is approved — every subsequent response carries the CORS echo.
  const cors = corsHeadersFor(req);

  // 3a. Per-slug GLOBAL ceiling first — bounds the per-tenant blast
  //     radius regardless of how many IPs an attacker rotates through.
  const rlGlobal = await rateLimit(`agent:${slug}:global`, GLOBAL_SLUG_CAPACITY, GLOBAL_SLUG_REFILL_PER_SEC);
  if (!rlGlobal.allowed) {
    await audit(agent, preSession, ip, {
      decision: "DENY",
      blocked_by: "rate_limited_global",
      reason: `slug=${slug} retry_after=${rlGlobal.retryAfterSec}s`,
    });
    return NextResponse.json(
      { ok: false, error: "rate_limited" },
      {
        status: 429,
        headers: { ...cors, "retry-after": String(Math.ceil(rlGlobal.retryAfterSec)) },
      },
    );
  }

  // 3b. Rate limit per (slug, IP) — the normal per-visitor bucket.
  const rl = await rateLimit(`agent:${slug}:${ip}`, RATE_CAPACITY, RATE_REFILL_PER_SEC);
  if (!rl.allowed) {
    await audit(agent, preSession, ip, {
      decision: "DENY",
      blocked_by: "rate_limited",
      reason: `retry_after=${rl.retryAfterSec}s`,
    });
    return NextResponse.json(
      { ok: false, error: "rate_limited" },
      {
        status: 429,
        headers: { ...cors, "retry-after": String(Math.ceil(rl.retryAfterSec)) },
      },
    );
  }

  // 4. Parse + validate
  let parsed;
  try {
    parsed = ChatRequestSchema.parse(await req.json());
  } catch {
    return safeError("bad_request", cors);
  }

  const lastUserMessage = [...parsed.messages].reverse().find((m) => m.role === "user");
  if (!lastUserMessage) return safeError("bad_request", cors);

  const sessionId = parsed.sessionId ?? `s_anon_${crypto.randomUUID().replace(/-/g, "").slice(0, 14)}`;

  // 5. PII Layer 1 + Layer 2
  let dlp = sanitize(lastUserMessage.content);
  let hasHighRiskPII = dlp.redactions.some((r) =>
    HIGH_RISK_PII.has(String(r.type).toUpperCase()),
  );
  if (!hasHighRiskPII && lastUserMessage.content.length >= 24) {
    try {
      const layer2 = await sanitizeWithLLM(lastUserMessage.content);
      if (layer2.layer2Available) {
        const layer2HighRisk = layer2.redactions.some((r) =>
          HIGH_RISK_PII.has(String(r.type).toUpperCase()),
        );
        if (layer2HighRisk) {
          dlp = layer2;
          hasHighRiskPII = true;
        }
      }
    } catch {
      // Layer 2 best-effort; never block on its failure
    }
  }

  if (hasHighRiskPII) {
    await audit(agent, sessionId, ip, {
      decision: "DENY",
      blocked_by: "dlp_layer1",
      reason: `pii_types:${dlp.redactions.map((r) => r.type).join(",")}`,
      redactionCount: dlp.redactions.length,
    });
    const refusal = agent.language === "es"
      ? "Detecté algo sensible en tu mensaje. Por favor no compartas información como números de tarjeta o seguro social aquí — para datos reales lo manejamos en un canal seguro."
      : "I noticed something sensitive in your message. Please don't share things like card numbers or SSNs here — for real data we handle that in a secured channel.";
    return NextResponse.json({ ok: true, reply: refusal }, { headers: cors });
  }

  // 6. Check paused_sessions — owner take-over closes critical gap #1
  if (await isSessionPaused(agent.engagementId, sessionId)) {
    await audit(agent, sessionId, ip, {
      decision: "DENY",
      blocked_by: "session_paused",
      reason: "owner_take_over",
    });
    const standdown = agent.language === "es"
      ? "Un miembro de nuestro equipo está respondiendo personalmente esta conversación. Por favor revisa tu correo — te escribirán pronto."
      : "A member of our team is responding to this conversation directly. Please check your email — you'll hear from them shortly.";
    return NextResponse.json({ ok: true, reply: standdown }, { headers: cors });
  }

  // 6b. Monthly token budget gate (migration 042). Once a tenant's
  //     month is exhausted we degrade gracefully — polite reply, audit
  //     DENY — instead of burning more Anthropic spend.
  if (await isBudgetExhausted(agent.workspaceId, agent.monthlyTokenBudget)) {
    await audit(agent, sessionId, ip, {
      decision: "DENY",
      blocked_by: "budget_exhausted",
      reason: `monthly_budget=${agent.monthlyTokenBudget}`,
    });
    const busy = agent.language === "es"
      ? "Estamos recibiendo un volumen alto de consultas este mes. Déjanos tu correo en el formulario de contacto y el equipo te responderá directamente."
      : "We're handling a high volume of inquiries this month. Please leave your email through the contact form and the team will get back to you directly.";
    return NextResponse.json({ ok: true, reply: busy }, { headers: cors });
  }

  // 7. Get Claude client
  const client = getClaudeClient();
  if (!client) {
    await audit(agent, sessionId, ip, {
      decision: "DENY",
      blocked_by: "service_unavailable",
      reason: "no_api_key",
    });
    return safeError("chat_unavailable", cors);
  }

  // 8. Build system prompt + filter tools to this agent's enabled set
  const system = buildAgentSystemPrompt(agent, parsed.locale);
  const allowedTools = agent.toolsEnabled
    .map((name) => TOOL_LOOKUP[name])
    .filter((t): t is Anthropic.Tool => !!t);

  // 9. Audit the user message turn (ALLOW)
  await audit(agent, sessionId, ip, {
    decision: "ALLOW",
    reason: "user_message",
    contentHash: sha256Hex(lastUserMessage.content),
  });

  // 10. First Claude call
  try {
    const first = await client.messages.create({
      model: process.env.ANTHROPIC_MODEL ?? "claude-haiku-4-5-20251001",
      max_tokens: agent.maxTokens,
      system,
      tools: allowedTools.length > 0 ? allowedTools : undefined,
      messages: parsed.messages.map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
    });

    // Track spend against the monthly budget regardless of which branch
    // the reply takes below.
    await recordUsage(
      agent.workspaceId,
      first.usage?.input_tokens ?? 0,
      first.usage?.output_tokens ?? 0,
    );

    const toolUseRaw = first.content.find(
      (b): b is Extract<typeof b, { type: "tool_use" }> => b.type === "tool_use",
    );
    // Even though we filtered the tool list sent to Claude, the model can
    // hallucinate a tool_use with any name (jailbreak / training-data
    // bleed). Re-validate against the agent's enabled set here so a
    // disabled tool name never reaches its handler.
    const toolUse =
      toolUseRaw && agent.toolsEnabled.includes(toolUseRaw.name) ? toolUseRaw : undefined;

    // ---- Tool: escalate_to_human ----
    if (toolUse && toolUse.name === "escalate_to_human") {
      let escalation;
      try {
        escalation = EscalationInputSchema.parse(toolUse.input);
      } catch {
        // Schema fail → fall back to text reply
        const text = first.content
          .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
          .map((b) => b.text)
          .join("\n")
          .trim();
        const reply = text || (agent.language === "es" ? "Un momento por favor." : "One moment please.");
        const interrupted = await checkPauseBeforeReply(agent, sessionId, ip, parsed.locale, cors);
        if (interrupted) return interrupted;
        await audit(agent, sessionId, ip, {
          decision: "ALLOW",
          reason: "assistant_reply",
          contentHash: sha256Hex(reply),
          tokensIn: first.usage?.input_tokens ?? null,
          tokensOut: first.usage?.output_tokens ?? null,
        });
        await persistTurn({
          workspaceId: agent.workspaceId,
          sessionId,
          userText: lastUserMessage.content,
          assistantText: reply,
        });
        return NextResponse.json({ ok: true, reply }, { headers: cors });
      }

      const { acknowledgement } = handleEscalateToHuman(
        {
          reason: escalation.reason,
          summary: escalation.summary,
          name: escalation.name,
          email: escalation.email,
        },
        parsed.locale,
      );

      if (escalation.email && escalation.email.includes("@")) {
        // Cap the composed reason string so it always fits the leads.reason
        // column regardless of how long the summary input was.
        const composedReason =
          `escalation:${escalation.reason}|${escalation.summary}`.slice(0, 480);
        await insertLead({
          sessionId,
          auditRequestId: crypto.randomUUID(),
          name: (escalation.name ?? "[escalation]").slice(0, 120),
          email: escalation.email,
          reason: composedReason,
          bookingLink: "[escalation path]",
          source: "chat_widget",
          ip,
          engagementId: agent.engagementId,
        });
      }

      const interruptedEsc = await checkPauseBeforeReply(agent, sessionId, ip, parsed.locale, cors);
      if (interruptedEsc) return interruptedEsc;
      await audit(agent, sessionId, ip, {
        decision: "ALLOW",
        reason: `escalation:${escalation.reason}`,
      });
      await audit(agent, sessionId, ip, {
        decision: "ALLOW",
        reason: "assistant_reply",
        contentHash: sha256Hex(acknowledgement),
        tokensIn: first.usage?.input_tokens ?? null,
        tokensOut: first.usage?.output_tokens ?? null,
      });
      await persistTurn({
        workspaceId: agent.workspaceId,
        sessionId,
        userText: lastUserMessage.content,
        assistantText: acknowledgement,
        toolSummary: `Escalated to human (${escalation.reason})`,
      });
      return NextResponse.json({ ok: true, reply: acknowledgement }, { headers: cors });
    }

    // ---- No tool call OR unsupported tool ----
    if (!toolUse || toolUse.name !== "request_booking") {
      const text = first.content
        .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      const reply = text || (agent.language === "es" ? "Un momento por favor." : "One moment please.");
      const interruptedNoTool = await checkPauseBeforeReply(agent, sessionId, ip, parsed.locale, cors);
      if (interruptedNoTool) return interruptedNoTool;
      await audit(agent, sessionId, ip, {
        decision: "ALLOW",
        reason: "assistant_reply",
        contentHash: sha256Hex(reply),
        tokensIn: first.usage?.input_tokens ?? null,
        tokensOut: first.usage?.output_tokens ?? null,
      });
      await persistTurn({
        workspaceId: agent.workspaceId,
        sessionId,
        userText: lastUserMessage.content,
        assistantText: reply,
      });
      return NextResponse.json({ ok: true, reply }, { headers: cors });
    }

    // ---- Tool: request_booking ----
    let booking: BookingPayload;
    try {
      booking = BookingInputSchema.parse(toolUse.input);
    } catch {
      return safeError("chat_failed", cors);
    }

    const { bookingLink, prefilledFor } = handleRequestBooking(booking);

    // Persist the lead — engagement-scoped now (closes critical gap #3)
    await insertLead({
      sessionId,
      auditRequestId: crypto.randomUUID(),
      name: booking.name,
      email: booking.email,
      reason: booking.reason,
      bookingLink,
      source: "chat_widget",
      ip,
      engagementId: agent.engagementId,
    });

    // Follow-up call with the tool result
    const followUp = await client.messages.create({
      model: process.env.ANTHROPIC_MODEL ?? "claude-haiku-4-5-20251001",
      max_tokens: agent.maxTokens,
      system,
      tools: allowedTools.length > 0 ? allowedTools : undefined,
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

    await recordUsage(
      agent.workspaceId,
      followUp.usage?.input_tokens ?? 0,
      followUp.usage?.output_tokens ?? 0,
    );

    const followText = followUp.content
      .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    const reply = followText || (agent.language === "es"
      ? `Listo. Te dejo el link: ${bookingLink}`
      : `Done. Here's your link: ${bookingLink}`);

    const interruptedBooking = await checkPauseBeforeReply(agent, sessionId, ip, parsed.locale, cors);
    if (interruptedBooking) return interruptedBooking;
    await audit(agent, sessionId, ip, {
      decision: "ALLOW",
      reason: "assistant_reply:booking_offered",
      contentHash: sha256Hex(reply),
      tokensIn: (first.usage?.input_tokens ?? 0) + (followUp.usage?.input_tokens ?? 0),
      tokensOut: (first.usage?.output_tokens ?? 0) + (followUp.usage?.output_tokens ?? 0),
    });
    await persistTurn({
      workspaceId: agent.workspaceId,
      sessionId,
      userText: lastUserMessage.content,
      assistantText: reply,
      toolSummary: `Booked discovery call for ${booking.name}`,
    });

    return NextResponse.json({ ok: true, reply, bookingLink }, { headers: cors });
  } catch (err) {
    const errCode = err instanceof Error ? err.name || "error" : "non_error";
    await audit(agent, sessionId, ip, {
      decision: "DENY",
      blocked_by: "upstream_error",
      reason: errCode,
    });
    return safeError("chat_failed");
  }
}
