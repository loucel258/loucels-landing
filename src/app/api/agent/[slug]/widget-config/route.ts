import { NextResponse } from "next/server";
import { rateLimit } from "@/lib/rate-limit/limiter";
import { resolveAgent, originAllowedForAgent } from "@/lib/agents/resolver";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Read-only public config consumed by the embeddable widget on init.
 * Returns ONLY presentation fields — never workspace_id, engagement_id,
 * system_prompt, or allowed_origins. The widget needs just enough to
 * theme itself (brand color, greeting, locale).
 *
 * Same CORS posture as the chat route: per-tenant allowlist, never `*`,
 * `Vary: Origin` on every response, no Allow-Credentials.
 */

const PREFLIGHT_BASE: Record<string, string> = {
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "600",
};

// Widget-config is cheap to compute (resolver is cached) but we still
// rate-limit per (slug, IP) to keep a misbehaving page from spamming
// the endpoint. 30 req/min is well above one fetch per page load.
const RATE_CAPACITY = 30;
const RATE_REFILL_PER_SEC = 0.5;

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

function corsHeadersFor(req: Request): Record<string, string> {
  const origin = req.headers.get("origin");
  if (!origin) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Vary": "Origin",
  };
}

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

export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await params;
  const agent = await resolveAgent(slug);
  // Always return the same 404 shape for unknown / unlive agents — don't
  // leak shadow / uat / designing states to public callers.
  if (!agent || agent.status !== "live") {
    return NextResponse.json({ ok: false, error: "agent_not_found" }, { status: 404 });
  }
  if (!originAllowedForAgent(req, agent)) {
    // No CORS headers — browser surfaces CORS error, which is the right
    // signal for an embed installed on an un-allowlisted domain.
    return NextResponse.json({ ok: false, error: "origin_blocked" }, { status: 403 });
  }

  const cors = corsHeadersFor(req);
  const ip = getClientIp(req);
  const rl = await rateLimit(`agent-cfg:${slug}:${ip}`, RATE_CAPACITY, RATE_REFILL_PER_SEC);
  if (!rl.allowed) {
    return NextResponse.json(
      { ok: false, error: "rate_limited" },
      {
        status: 429,
        headers: { ...cors, "retry-after": String(Math.ceil(rl.retryAfterSec)) },
      },
    );
  }

  return NextResponse.json(
    {
      ok: true,
      config: {
        slug: agent.slug,
        name: agent.name,
        brandColor: agent.brandColor ?? "#0891b2",
        greetingMessage: agent.greetingMessage ?? null,
        language: agent.language,
      },
    },
    { headers: cors },
  );
}
