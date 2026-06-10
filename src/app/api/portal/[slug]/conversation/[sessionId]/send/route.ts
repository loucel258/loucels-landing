import { NextResponse } from "next/server";
import { z } from "zod";
import { isPortalAuthed } from "@/lib/portal/auth";
import { getServiceClient } from "@/lib/audit/client";
import { rateLimit } from "@/lib/rate-limit/limiter";
import { encryptMessage } from "@/lib/portal/encrypt";
import { sendEmail } from "@/lib/notify/resend";
import { writeAuditEntry } from "@/lib/audit/writer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const InputSchema = z.object({
  text: z.string().min(1).max(4000),
});

function getClientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

/**
 * POST /api/portal/[slug]/conversation/[sessionId]/send
 *
 * Owner take-over: append a manual message to a conversation as if the
 * agent sent it, pause the agent for that session, and try to deliver
 * the message to the visitor's email if we have it on file.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug: string; sessionId: string }> },
): Promise<Response> {
  const { slug, sessionId } = await params;
  const ip = getClientIp(req);

  if (!(await isPortalAuthed(slug))) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const rl = await rateLimit(`portal_takeover:${slug}:${ip}`, 30, 30 / 3600);
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
  if (!sb) return NextResponse.json({ ok: false, error: "service_unavailable" }, { status: 503 });

  const { data: access } = await sb
    .from("client_portal_access")
    .select("engagement_id, display_name")
    .eq("client_slug", slug)
    .maybeSingle();
  if (!access) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const engagementId = (access as { engagement_id: string }).engagement_id;
  const displayName = (access as { display_name: string }).display_name;

  // Verify the session belongs to this engagement
  const { data: existingMsg } = await sb
    .from("conversation_messages")
    .select("workspace_id")
    .eq("session_id", sessionId)
    .eq("engagement_id", engagementId)
    .limit(1)
    .maybeSingle();
  if (!existingMsg) {
    return NextResponse.json({ ok: false, error: "session_not_found" }, { status: 404 });
  }
  const workspaceId = (existingMsg as { workspace_id: string }).workspace_id;

  // Persist the owner's message as if the agent sent it (tool_summary
  // labels it so the Bandeja UI can render the take-over marker).
  const expiresAt = new Date(Date.now() + 90 * 86400_000).toISOString();
  const { error: insertErr } = await sb
    .from("conversation_messages")
    .insert({
      engagement_id: engagementId,
      workspace_id: workspaceId,
      session_id: sessionId,
      role: "assistant",
      cipher_b64: encryptMessage(engagementId, body.text),
      tool_summary: `Sent by ${displayName}`,
      expires_at: expiresAt,
    });
  if (insertErr) {
    return NextResponse.json({ ok: false, error: "insert_failed" }, { status: 500 });
  }

  // Mark the session paused so the chat agent stands down on its next turn.
  await sb
    .from("paused_sessions")
    .upsert(
      {
        session_id: sessionId,
        engagement_id: engagementId,
        paused_by: `portal:${slug}`,
        paused_at: new Date().toISOString(),
        reason: "owner_take_over",
      },
      { onConflict: "session_id" },
    );

  // Best-effort: email the visitor if we have their address from a linked lead
  const { data: lead } = await sb
    .from("leads")
    .select("email, name")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  let emailDelivered = false;
  if (lead && (lead as { email: string }).email) {
    const sent = await sendEmail({
      to: (lead as { email: string }).email,
      subject: `Follow-up from ${displayName}`,
      html: `<div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;padding:24px;line-height:1.55;color:#111">${body.text.replace(/\n/g, "<br>")}</div>`,
    });
    if (sent.ok) emailDelivered = true;
  }

  // Audit trail
  await writeAuditEntry({
    request_id: crypto.randomUUID(),
    workspace_id: workspaceId,
    user_id: sessionId,
    role: "client_portal",
    ip_address: null,
    source: "portal",
    sanitized_prompt_hash: "",
    decision: "ALLOW",
    blocked_by: null,
    reason: `take_over_message:${emailDelivered ? "emailed" : "queued"}`,
  });

  return NextResponse.json({ ok: true, emailDelivered });
}

/**
 * DELETE — release the take-over (agent resumes)
 */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ slug: string; sessionId: string }> },
): Promise<Response> {
  const { slug, sessionId } = await params;

  if (!(await isPortalAuthed(slug))) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ ok: false, error: "service_unavailable" }, { status: 503 });

  const { data: access } = await sb
    .from("client_portal_access")
    .select("engagement_id")
    .eq("client_slug", slug)
    .maybeSingle();
  if (!access) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  await sb
    .from("paused_sessions")
    .delete()
    .eq("session_id", sessionId)
    .eq("engagement_id", (access as { engagement_id: string }).engagement_id);

  return NextResponse.json({ ok: true });
}
