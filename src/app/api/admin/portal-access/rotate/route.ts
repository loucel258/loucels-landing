import { NextResponse } from "next/server";
import { z } from "zod";
import crypto from "node:crypto";
import { getServiceClient } from "@/lib/audit/client";
import { isAdminAuthed } from "@/lib/admin/auth";
import { hashPasscode, generatePasscodeSalt } from "@/lib/portal/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Rotate the passcode for an existing portal access row. Mirrors
 * scripts/provision-portal.mjs but reachable from the admin UI.
 * Returns the new passcode once — never stored in plaintext.
 */

const InputSchema = z.object({
  clientSlug: z
    .string()
    .min(2)
    .max(64)
    .regex(/^[a-z0-9-]+$/),
});

function generatePasscode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.randomBytes(16);
  let out = "";
  for (let i = 0; i < 16; i++) {
    out += alphabet[bytes[i]! % alphabet.length];
  }
  return out.slice(0, 4) + "-" + out.slice(4, 8) + "-" + out.slice(8, 12) + "-" + out.slice(12, 16);
}

export async function POST(req: Request): Promise<Response> {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let input: z.infer<typeof InputSchema>;
  try {
    input = InputSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_input" }, { status: 400 });
  }

  const sb = getServiceClient();
  if (!sb) {
    return NextResponse.json({ ok: false, error: "service_unavailable" }, { status: 503 });
  }

  const passcode = generatePasscode();
  const salt = generatePasscodeSalt();
  const hash = hashPasscode(passcode, salt);

  const { data, error } = await sb
    .from("client_portal_access")
    .update({ passcode_hash: hash, passcode_salt: salt, active: true, revoked_at: null })
    .eq("client_slug", input.clientSlug)
    .select("id");

  if (error) {
    return NextResponse.json(
      { ok: false, error: "update_failed", detail: error.message },
      { status: 500 },
    );
  }
  if (!data || data.length === 0) {
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    clientSlug: input.clientSlug,
    passcode,
    portalUrl: `/portal/${input.clientSlug}`,
  });
}
