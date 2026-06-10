import { NextResponse } from "next/server";
import { z } from "zod";
import crypto from "node:crypto";
import { getServiceClient } from "@/lib/audit/client";
import { isAdminAuthed } from "@/lib/admin/auth";
import { hashPasscode, generatePasscodeSalt } from "@/lib/portal/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Provision portal access for an engagement.
 *
 * Body:
 *   { engagementId: uuid, clientSlug: string, displayName: string,
 *     passcode?: string }   // omit to auto-generate a 16-char code
 *
 * Returns the generated passcode (one-time — Steven copies it and DMs the
 * client). Hashed at rest; we never store the plaintext.
 */

const InputSchema = z.object({
  engagementId: z.string().uuid(),
  clientSlug: z
    .string()
    .min(2)
    .max(64)
    .regex(/^[a-z0-9-]+$/, "lowercase letters, digits, and dashes only"),
  displayName: z.string().min(1).max(120),
  passcode: z.string().min(8).max(120).optional(),
});

function generatePasscode(): string {
  // 16 chars, URL-safe, easy to read aloud: no 0/O/1/l/I
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

  let input;
  try {
    input = InputSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_input" }, { status: 400 });
  }

  const sb = getServiceClient();
  if (!sb) {
    return NextResponse.json({ ok: false, error: "service_unavailable" }, { status: 503 });
  }

  const passcode = input.passcode ?? generatePasscode();
  const salt = generatePasscodeSalt();
  const hash = hashPasscode(passcode, salt);

  const { error } = await sb
    .from("client_portal_access")
    .insert({
      engagement_id: input.engagementId,
      client_slug: input.clientSlug,
      passcode_hash: hash,
      passcode_salt: salt,
      display_name: input.displayName,
    });

  if (error) {
    if ((error as { code?: string }).code === "23505") {
      return NextResponse.json(
        { ok: false, error: "slug_taken", detail: "That client_slug is already in use." },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { ok: false, error: "insert_failed", detail: error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    clientSlug: input.clientSlug,
    passcode, // one-time return — store it in 1Password under the client name
    portalUrl: `/portal/${input.clientSlug}`,
  });
}
