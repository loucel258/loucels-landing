import { NextResponse } from "next/server";
import { isPortalAuthed } from "@/lib/portal/auth";
import { getServiceClient } from "@/lib/audit/client";
import { decryptMessage, encryptionAvailable } from "@/lib/portal/encrypt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Polled by the Live Activity widget on the portal Resumen. Returns the
 * last N decrypted conversation events scoped to the slug's engagement.
 *
 * Cheap to call — pulls only the latest 10 messages. The client polls
 * every 10s. We don't paginate because the feed is fixed-size.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await params;
  if (!(await isPortalAuthed(slug))) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ ok: false, items: [] });

  const { data: access } = await sb
    .from("client_portal_access")
    .select("engagement_id")
    .eq("client_slug", slug)
    .maybeSingle();
  if (!access) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });

  const engagementId = (access as { engagement_id: string }).engagement_id;

  const { data } = await sb
    .from("conversation_messages")
    .select("id, inserted_at, role, tool_summary, cipher_b64, session_id")
    .eq("engagement_id", engagementId)
    .order("inserted_at", { ascending: false })
    .limit(10);

  const rows = (data as Array<{
    id: string;
    inserted_at: string;
    role: "user" | "assistant" | "tool" | "system_event";
    tool_summary: string | null;
    cipher_b64: string;
    session_id: string;
  }>) ?? [];

  const canDecrypt = encryptionAvailable();
  const items = rows.map((r) => {
    let text = r.tool_summary ?? "";
    if (!text && canDecrypt) {
      try {
        text = decryptMessage(engagementId, r.cipher_b64);
      } catch {
        text = "[encrypted]";
      }
    }
    return {
      id: r.id,
      insertedAt: r.inserted_at,
      role: r.role,
      sessionId: r.session_id,
      preview: text.slice(0, 90) + (text.length > 90 ? "…" : ""),
    };
  });

  return NextResponse.json({ ok: true, items }, {
    headers: { "cache-control": "no-store" },
  });
}
