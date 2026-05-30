import { NextResponse } from "next/server";
import { sanitize } from "@/lib/dlp/sanitizer";
import { sanitizeWithLLM } from "@/lib/dlp/sanitizer-llm";
import { extractBearerToken, verifyWorkspaceJwt } from "@/lib/auth/jwt";
import { getLayer2Required, Layer2RequiredError } from "@/lib/clients/policy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_PROMPT_CHARS = 10_000;

/**
 * Server-side DLP preview. Requires a workspace-scoped JWT — the previous
 * "anyone can hit this endpoint" behavior was a denial-of-wallet vector
 * against the Anthropic Layer 2 path. The JWT pins the request to a
 * workspace; the same pattern as /api/demo/rbac.
 */
export async function POST(req: Request) {
  // --- AuthN ---
  const token = extractBearerToken(req);
  if (!token) {
    return NextResponse.json(
      { error: "Missing Authorization Bearer token" },
      { status: 401 },
    );
  }
  let claims;
  try {
    claims = await verifyWorkspaceJwt(token);
  } catch (err) {
    return NextResponse.json(
      {
        error: "Invalid or expired token",
        detail: err instanceof Error ? err.message : "unknown",
      },
      { status: 401 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const rawPrompt =
    body && typeof body === "object" && "prompt" in body
      ? String((body as { prompt: unknown }).prompt ?? "")
      : "";
  const useLayer2 =
    body && typeof body === "object" && "layer2" in body
      ? Boolean((body as { layer2: unknown }).layer2)
      : false;

  if (rawPrompt.length > MAX_PROMPT_CHARS) {
    return NextResponse.json(
      { error: `Prompt exceeds maximum length of ${MAX_PROMPT_CHARS} characters` },
      { status: 413 },
    );
  }

  let result;
  if (useLayer2) {
    const failClosed = await getLayer2Required(claims.workspace_id);
    try {
      result = await sanitizeWithLLM(rawPrompt, {
        failClosed,
        workspace_id: claims.workspace_id,
      });
    } catch (err) {
      if (err instanceof Layer2RequiredError) {
        return NextResponse.json(
          {
            error: "Layer 2 classifier required but unavailable",
            code: err.code,
            workspace_id: err.workspace_id,
          },
          { status: 503 },
        );
      }
      throw err;
    }
  } else {
    result = sanitize(rawPrompt);
  }
  return NextResponse.json(result);
}
