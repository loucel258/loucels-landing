import { NextResponse } from "next/server";
import { mintWorkspaceJwt } from "@/lib/auth/jwt";
import { rateLimit, clientKey } from "@/lib/rate-limit/limiter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Demo-only JWT minter.
 *
 * Returns a workspace-scoped JWT for the in-house Trust Stack demos. The
 * payload is whatever workspace_id + role_label the caller asks for, which
 * IS unsafe in production — but the route is gated to ws_demo_001 only
 * to make sure no real tenant can be impersonated via this endpoint.
 *
 * Production agents get JWTs minted by their dedicated webhook handlers
 * (e.g., a Twilio webhook handler that has already verified the signature
 * and looked up the routing), not by an open POST.
 */
export async function POST(req: Request) {
  // Rate limit: 30 mints per minute per IP. A normal demo session needs
  // ~1 mint per 5 minutes (token TTL); 30/min still leaves room for
  // multiple tabs and re-mints, while killing a script that tries to
  // farm tokens to flood our downstream LLM budget.
  const rl = rateLimit(`auth-mint:${clientKey(req)}`, 30, 30 / 60);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many token requests", retry_after_seconds: rl.retryAfterSec },
      { status: 429, headers: { "retry-after": String(rl.retryAfterSec) } },
    );
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const workspace_id = String(body.workspace_id ?? "ws_demo_001");
  const role_label = body.role_label ? String(body.role_label) : undefined;

  // Hard gate: this endpoint must NEVER mint tokens for real tenants.
  if (workspace_id !== "ws_demo_001") {
    return NextResponse.json(
      { error: "Demo auth endpoint accepts only ws_demo_001" },
      { status: 403 },
    );
  }

  try {
    const token = await mintWorkspaceJwt({
      workspace_id,
      role_label,
      ttlSeconds: 300,
    });
    return NextResponse.json({ token, ttl_seconds: 300 });
  } catch (err) {
    return NextResponse.json(
      {
        error: "Failed to mint token",
        detail: err instanceof Error ? err.message : "unknown",
      },
      { status: 500 },
    );
  }
}
