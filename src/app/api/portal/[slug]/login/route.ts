import { NextResponse } from "next/server";
import { z } from "zod";
import { cookies } from "next/headers";
import { getServiceClient } from "@/lib/audit/client";
import { rateLimit } from "@/lib/rate-limit/limiter";
import {
  verifyPasscode,
  mintPortalSession,
  cookieName,
  portalCookieOptions,
} from "@/lib/portal/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const InputSchema = z.object({ passcode: z.string().min(1).max(200) });

function getClientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await params;
  const ip = getClientIp(req);

  // 5 attempts/hour per (slug, IP). Tighter than admin since this is
  // exposed publicly via /portal/[slug].
  const rl = rateLimit(`portal_login:${slug}:${ip}`, 5, 5 / 3600);
  if (!rl.allowed) {
    return NextResponse.json(
      { ok: false, error: "rate_limited" },
      { status: 429, headers: { "retry-after": String(rl.retryAfterSec) } },
    );
  }

  let body;
  try {
    body = InputSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  }

  const sb = getServiceClient();
  if (!sb) {
    return NextResponse.json({ ok: false, error: "service_unavailable" }, { status: 503 });
  }

  const { data: access } = await sb
    .from("client_portal_access")
    .select("id, passcode_hash, passcode_salt, active, revoked_at, engagement_id")
    .eq("client_slug", slug)
    .maybeSingle();

  // Always return the same generic error for: slug not found, revoked,
  // inactive, or wrong passcode. Prevents slug enumeration via timing or
  // status code differences.
  const genericFail = NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  if (!access || !access.active || access.revoked_at) {
    // eslint-disable-next-line no-console
    console.warn("[portal/login] failed: slug missing or revoked", { slug, ip });
    return genericFail;
  }

  if (!verifyPasscode(body.passcode.trim(), access.passcode_hash as string, access.passcode_salt as string)) {
    // eslint-disable-next-line no-console
    console.warn("[portal/login] failed: bad passcode", { slug, ip });
    return genericFail;
  }

  const token = mintPortalSession(slug);
  if (!token) {
    return NextResponse.json({ ok: false, error: "service_unavailable" }, { status: 503 });
  }
  const jar = await cookies();
  jar.set(cookieName(slug), token, portalCookieOptions());

  // Update last_login + counter (best-effort)
  await sb
    .from("client_portal_access")
    .update({
      last_login_at: new Date().toISOString(),
      login_count: ((access as { login_count?: number }).login_count ?? 0) + 1,
    })
    .eq("id", access.id);

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await params;
  const jar = await cookies();
  jar.delete(cookieName(slug));
  return NextResponse.json({ ok: true });
}
