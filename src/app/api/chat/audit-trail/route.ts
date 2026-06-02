import { NextResponse } from "next/server";
import { z } from "zod";
import { readChatSessionTrail } from "@/lib/audit/chat-reader";
import { rateLimit } from "@/lib/rate-limit/limiter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Burst 6 / 30 per hour per IP — visitors will only hit this when they
// click "view trail" and refresh, not in tight loops.
const RATE_CAPACITY = 6;
const RATE_REFILL_PER_SEC = 30 / 3600;

const QuerySchema = z.object({
  sessionId: z.string().min(8).max(64),
});

function getClientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

export async function GET(req: Request) {
  const ip = getClientIp(req);
  const rl = rateLimit(`chat-audit:${ip}`, RATE_CAPACITY, RATE_REFILL_PER_SEC);
  if (!rl.allowed) {
    return NextResponse.json(
      { ok: false, error: "rate_limited" },
      { status: 429, headers: { "retry-after": String(Math.ceil(rl.retryAfterSec)) } },
    );
  }

  const url = new URL(req.url);
  let parsed;
  try {
    parsed = QuerySchema.parse({ sessionId: url.searchParams.get("sessionId") });
  } catch {
    return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  }

  const result = await readChatSessionTrail(parsed.sessionId);
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.reason },
      { status: result.reason === "not_configured" ? 503 : 502 },
    );
  }
  return NextResponse.json({ ok: true, rows: result.rows });
}
