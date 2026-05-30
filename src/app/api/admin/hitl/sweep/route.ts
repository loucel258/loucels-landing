import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/audit/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Vercel-Cron / external-scheduler entry point for the HITL orphan
 * sweeper (migration 015). Calls `public.hitl_sweep_orphans(p_stale)`
 * which rolls any row stuck in `approving` past the threshold back to
 * `pending`. This is the backstop for the case where the saga's external
 * call hung past the route's hard timeout (or the Node process crashed
 * mid-flight) and the row never reached a terminal state.
 *
 * AUTH
 * ----
 * Gated by a shared secret in the `x-sweeper-secret` header (compared
 * against `HITL_SWEEPER_SECRET`). The secret lives only on Vercel and
 * is never sent client-side. If the env var isn't set we refuse all
 * calls — fail-closed rather than expose an unauthenticated mutation
 * surface.
 *
 * Vercel Cron config (add to vercel.json):
 *
 *   { "crons": [
 *       { "path": "/api/admin/hitl/sweep", "schedule": "* * * * *" }
 *     ]
 *   }
 *
 * Vercel Cron requests carry a `x-vercel-cron` header AND the project's
 * `CRON_SECRET` in `Authorization: Bearer`. We accept either auth path
 * so the same route works for Vercel Cron and a plain curl from ops.
 */
export async function POST(req: Request) {
  const sharedSecret = process.env.HITL_SWEEPER_SECRET;
  const vercelCronSecret = process.env.CRON_SECRET;

  if (!sharedSecret && !vercelCronSecret) {
    return NextResponse.json(
      { error: "Sweeper not configured (HITL_SWEEPER_SECRET or CRON_SECRET missing)" },
      { status: 500 },
    );
  }

  const headerSecret = req.headers.get("x-sweeper-secret") ?? "";
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";

  const headerOk = sharedSecret && timingSafeEqual(headerSecret, sharedSecret);
  const bearerOk = vercelCronSecret && timingSafeEqual(bearer, vercelCronSecret);
  if (!headerOk && !bearerOk) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const client = getServiceClient();
  if (!client) {
    return NextResponse.json(
      { ok: false, reason: "not_configured" },
      { status: 200 },
    );
  }

  // Default stale window 90s (matches the doc in migration 015). Caller
  // can override with ?stale=<seconds> for ops-driven manual sweeps.
  const url = new URL(req.url);
  const staleParam = url.searchParams.get("stale");
  const stale = staleParam ? Math.max(30, Math.min(3600, parseInt(staleParam, 10))) : 90;

  const { data, error } = await client.rpc("hitl_sweep_orphans", {
    p_stale_seconds: stale,
  });
  if (error) {
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 },
    );
  }
  const swept = typeof data === "number" ? data : Number(data ?? 0);
  return NextResponse.json({ ok: true, swept, stale_seconds: stale });
}

// Vercel Cron sends GET requests by default; mirror the handler so the
// same secret works for both.
export const GET = POST;

/**
 * Constant-time string compare. Prevents an attacker from learning the
 * secret length / prefix via response-time analysis. Pure userland —
 * doesn't depend on node:crypto being available at edge runtime.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
