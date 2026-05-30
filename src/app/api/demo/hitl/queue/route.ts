import { NextResponse } from "next/server";
import { readQueue } from "@/lib/hitl/queue";
import { extractBearerToken, verifyWorkspaceJwt } from "@/lib/auth/jwt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const token = extractBearerToken(req);
  if (!token) {
    return NextResponse.json(
      { ok: false, reason: "unauthorized", error: "Missing Authorization Bearer token" },
      { status: 401 },
    );
  }
  let claims;
  try {
    claims = await verifyWorkspaceJwt(token);
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        reason: "unauthorized",
        error: "Invalid or expired token",
        detail: err instanceof Error ? err.message : "unknown",
      },
      { status: 401 },
    );
  }
  const result = await readQueue(50, claims.workspace_id);
  return NextResponse.json(result);
}
