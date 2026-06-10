import { NextResponse } from "next/server";
import { z } from "zod";
import { isPortalAuthed } from "@/lib/portal/auth";
import { getServiceClient } from "@/lib/audit/client";
import { rateLimit } from "@/lib/rate-limit/limiter";
import { approveAction } from "@/lib/portal/hitl";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const InputSchema = z.object({
  approvalId: z.string().uuid(),
  editedText: z.string().max(8000).optional(),
});

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

  if (!(await isPortalAuthed(slug))) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const rl = await rateLimit(`portal_hitl_approve:${slug}:${ip}`, 20, 20 / 3600);
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

  // Resolve workspace_id for this slug so a portal user cannot approve
  // an arbitrary approval id from another client.
  const { data: access } = await sb
    .from("client_portal_access")
    .select("engagement_id")
    .eq("client_slug", slug)
    .maybeSingle();
  if (!access) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const { data: agent } = await sb
    .from("client_agents")
    .select("workspace_id")
    .eq("engagement_id", (access as { engagement_id: string }).engagement_id)
    .limit(1)
    .maybeSingle();
  if (!agent) {
    return NextResponse.json({ ok: false, error: "no_agent" }, { status: 404 });
  }

  const result = await approveAction({
    approvalId: body.approvalId,
    workspaceId: (agent as { workspace_id: string }).workspace_id,
    decider: `portal:${slug}`,
    editedText: body.editedText,
    clientSlug: slug,
  });

  if (!result.ok) {
    const code = result.reason === "not_found" ? 404 : result.reason === "already_decided" ? 409 : 500;
    return NextResponse.json({ ok: false, error: result.reason }, { status: code });
  }

  return NextResponse.json({ ok: true, executedRealtime: result.executedRealtime });
}
