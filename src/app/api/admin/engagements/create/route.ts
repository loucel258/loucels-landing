import { NextResponse } from "next/server";
import { z } from "zod";
import { getServiceClient } from "@/lib/audit/client";
import { isAdminAuthed } from "@/lib/admin/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/engagements/create
 *
 * Seed a new engagement row when a prospect signs up. The dashboard form
 * calls this; webhooks (DocuSign / Stripe / Tally) update the row that
 * already exists.
 *
 * Auth: same cookie gate as /admin/chat-pulse — ADMIN_DASHBOARD_PASSWORD
 * env var must match the loucel_admin_token cookie value.
 *
 * Generates the engagement_ref (OGA-YYYYMMDD-INITIALS) server-side to
 * match the bash scaffolding convention. Returns the ref so the operator
 * can run `bash gap-audit-kit/bin/new-engagement.sh ...` with the same
 * reference for the local folder.
 */


const InputSchema = z.object({
  clientLegalName: z.string().min(2).max(200),
  clientEmail: z.string().email().max(200),
  vertical: z.string().max(60).optional(),
  language: z.enum(["en", "es"]).default("en"),
  engagementType: z
    .enum(["gap_audit", "smv_build", "integration_control"])
    .default("gap_audit"),
  auditFeeCents: z.number().int().min(0).default(50000),
  leadId: z.string().uuid().optional(),
  notes: z.string().max(2000).optional(),
});

function buildReference(clientLegalName: string): string {
  const dateStamp = new Date()
    .toISOString()
    .slice(0, 10)
    .replace(/-/g, "");

  // Same initials logic as bin/new-engagement.sh: first letter of each word,
  // uppercase, alphanumeric only, max 4 chars
  const initials = clientLegalName
    .split(/\s+/)
    .map((w) => w[0] ?? "")
    .join("")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 4);

  return `OGA-${dateStamp}-${initials || "XXXX"}`;
}

export async function POST(req: Request): Promise<Response> {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let input;
  try {
    input = InputSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_input" }, { status: 400 });
  }

  const sb = getServiceClient();
  if (!sb) {
    return NextResponse.json(
      { ok: false, error: "service_unavailable" },
      { status: 503 },
    );
  }

  const engagementRef = buildReference(input.clientLegalName);

  const { data, error } = await sb
    .from("engagements")
    .insert({
      engagement_ref: engagementRef,
      lead_id: input.leadId ?? null,
      client_legal_name: input.clientLegalName,
      client_email: input.clientEmail.toLowerCase(),
      vertical: input.vertical ?? null,
      language: input.language,
      engagement_type: input.engagementType,
      audit_fee_cents: input.auditFeeCents,
      notes: input.notes ?? null,
      status: "prospect_signed_up",
    })
    .select("id, engagement_ref")
    .single();

  if (error) {
    // eslint-disable-next-line no-console
    console.warn("[engagements/create] insert failed:", error.message);
    // Unique constraint on engagement_ref means we tried to insert two on
    // the same day for the same initials — append a suffix and retry once.
    if (error.code === "23505") {
      const retryRef = `${engagementRef}-2`;
      const retry = await sb
        .from("engagements")
        .insert({
          engagement_ref: retryRef,
          lead_id: input.leadId ?? null,
          client_legal_name: input.clientLegalName,
          client_email: input.clientEmail.toLowerCase(),
          vertical: input.vertical ?? null,
          language: input.language,
          engagement_type: input.engagementType,
          audit_fee_cents: input.auditFeeCents,
          notes: input.notes ?? null,
          status: "prospect_signed_up",
        })
        .select("id, engagement_ref")
        .single();
      if (retry.error) {
        return NextResponse.json(
          { ok: false, error: "insert_failed", detail: retry.error.message },
          { status: 500 },
        );
      }
      return NextResponse.json({
        ok: true,
        engagementId: retry.data.id,
        engagementRef: retry.data.engagement_ref,
      });
    }
    return NextResponse.json(
      { ok: false, error: "insert_failed", detail: error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    engagementId: data.id,
    engagementRef: data.engagement_ref,
  });
}
