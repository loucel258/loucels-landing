import { NextResponse } from "next/server";
import { z } from "zod";
import { isPortalAuthed } from "@/lib/portal/auth";
import { getServiceClient } from "@/lib/audit/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const InputSchema = z.object({ language: z.enum(["en", "es"]) });

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await params;
  if (!(await isPortalAuthed(slug))) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  let body;
  try {
    body = InputSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  }
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ ok: false, error: "service_unavailable" }, { status: 503 });

  await sb
    .from("client_portal_access")
    .update({ preferred_language: body.language })
    .eq("client_slug", slug);

  return NextResponse.json({ ok: true });
}
