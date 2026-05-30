import { NextResponse } from "next/server";
import { sanitize } from "@/lib/dlp/sanitizer";
import { sanitizeWithLLM } from "@/lib/dlp/sanitizer-llm";
import { getLayer2Required, Layer2RequiredError } from "@/lib/clients/policy";
import { writeAuditEntry } from "@/lib/audit/writer";
import { normalizeRedactionSummary } from "@/lib/audit/redaction-summary";
import { sha256Hex } from "@/lib/crypto/hash";
import { assertJwtStillValid, extractBearerToken, verifyWorkspaceJwt } from "@/lib/auth/jwt";
import { rateLimit, clientKey } from "@/lib/rate-limit/limiter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_PROMPT_CHARS = 10_000;

export async function POST(req: Request) {
  // Rate limit: 60 record-writes per minute per IP. Each call writes one
  // audit row AND optionally hits Anthropic Layer 2; both are real cost
  // we don't want a script farming.
  const rl = rateLimit(`dlp-record:${clientKey(req)}`, 60, 60 / 60);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many requests", retry_after_seconds: rl.retryAfterSec },
      { status: 429, headers: { "retry-after": String(rl.retryAfterSec) } },
    );
  }
  // --- AuthN: require workspace JWT (closes the anon-write hole that let
  // anyone fill the audit log under ws_demo_001). ---
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
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const rawPrompt =
    body && typeof body === "object" && "prompt" in body
      ? String((body as { prompt: unknown }).prompt ?? "")
      : "";
  const useLayer2 =
    body && typeof body === "object" && "layer2" in body
      ? Boolean((body as { layer2: unknown }).layer2)
      : false;

  if (!rawPrompt) {
    return NextResponse.json(
      { error: "Missing `prompt` field" },
      { status: 400 },
    );
  }

  if (rawPrompt.length > MAX_PROMPT_CHARS) {
    return NextResponse.json(
      {
        error: `Prompt exceeds maximum length of ${MAX_PROMPT_CHARS} characters`,
      },
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

  // Re-check JWT expiry after the LLM round trip. sanitizeWithLLM can
  // take several seconds; refuse to audit under a stale identity.
  try {
    assertJwtStillValid(claims);
  } catch (err) {
    return NextResponse.json(
      {
        error: "JWT expired before response could be sealed",
        detail: err instanceof Error ? err.message : "unknown",
      },
      { status: 401 },
    );
  }

  const requestId = `req_${crypto.randomUUID().slice(0, 12)}`;
  const ipAddress =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;

  const auditResult = await writeAuditEntry({
    request_id: requestId,
    workspace_id: claims.workspace_id,
    user_id: `u_${claims.role_label ?? "dlp"}_${claims.sub.slice(-6)}`,
    role: claims.role_label ?? "front_desk_agent",
    ip_address: ipAddress,
    source: "dlp",
    decision: "ALLOW",
    blocked_by: null,
    reason: `Sanitized ${result.stats.totalRedactions} sensitive value(s). Layer 2: ${
      result.layer2Used ? (result.layer2Available ? "applied" : "unavailable") : "off"
    }.`,
    sanitized_prompt_hash: sha256Hex(result.sanitized),
    redaction_count: result.stats.totalRedactions,
    redaction_summary: normalizeRedactionSummary({
      kind: "dlp",
      by_type: result.stats.byType,
      layer2_used: result.layer2Used ? 1 : 0,
      layer2_available: result.layer2Available ? 1 : 0,
      from_regex: result.stats.bySource.regex,
      from_context: result.stats.bySource.context,
      from_llm: result.stats.bySource.llm,
    }),
  });

  // Fail-closed audit: if the forensic record didn't land, refuse to return
  // the sanitized result. The contract with the caller is "every accepted
  // call is auditable" — silently shipping the response when audit failed
  // would break that contract. Exception: when Supabase is simply not
  // configured (demo env), we still serve the result with a clear warning.
  if (!auditResult.ok && auditResult.reason !== "not_configured") {
    return NextResponse.json(
      {
        error: "Audit write failed — refusing to return sanitized result.",
        detail: auditResult.error ?? "unknown",
        request_id: requestId,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ...result,
    audit: auditResult,
    request_id: requestId,
  });
}
