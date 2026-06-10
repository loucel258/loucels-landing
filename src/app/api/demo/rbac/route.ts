import { NextResponse } from "next/server";
import { evaluateWithLLM } from "@/lib/rbac/policy-llm";
import { getLayer2Required, Layer2RequiredError } from "@/lib/clients/policy";
import { buildSecurityContext, type SessionContext } from "@/lib/rbac/context-injection";
import type { Role } from "@/lib/rbac/roles";
import { writeAuditEntry } from "@/lib/audit/writer";
import { normalizeRedactionSummary } from "@/lib/audit/redaction-summary";
import { assertJwtStillValid, extractBearerToken, verifyWorkspaceJwt } from "@/lib/auth/jwt";
import { rateLimit, clientKey } from "@/lib/rate-limit/limiter";
import { isWorkspaceRoleValid } from "@/lib/rbac/role-validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_QUERY_CHARS = 5_000;
const VALID_ROLES: Role[] = ["front_desk_agent", "compliance_officer"];

/**
 * POST /api/demo/rbac
 *
 * Authentication: requires a workspace-scoped JWT in the Authorization
 * header. The JWT's `role_label` claim drives the policy decision; the body
 * NO LONGER trusts a `role` field — that was demo theater and a major
 * security gap. The query string still comes from the body.
 *
 * The JWT also pins the workspace_id, so all writes to audit_logs land in
 * the correct tenant. No more hardcoded ws_demo_001 in this path.
 */
export async function POST(req: Request) {
  // Rate limit: 60 evaluations per minute per IP. Each one runs the
  // Layer 2 Claude classifier — keep a script from emptying the budget.
  const rl = await rateLimit(`rbac-eval:${clientKey(req)}`, 60, 60 / 60);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many requests", retry_after_seconds: rl.retryAfterSec },
      { status: 429, headers: { "retry-after": String(rl.retryAfterSec) } },
    );
  }
  // --- AuthN: verify JWT (no JWT → 401, no exceptions) ---
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

  // --- AuthZ: role must be in workspace_roles AND have a code-level
  // policy profile. The first check (DB) allows tenants to onboard new
  // roles without a code deploy; the second (TS enum) prevents a role
  // with no policy from being silently allowed. ---
  const role = (claims.role_label ?? "") as Role;
  if (!VALID_ROLES.includes(role)) {
    return NextResponse.json(
      {
        error: `JWT role_label has no policy profile loaded: ${claims.role_label ?? "(empty)"}`,
      },
      { status: 403 },
    );
  }
  const dbValid = await isWorkspaceRoleValid(claims.workspace_id, role);
  if (!dbValid) {
    return NextResponse.json(
      {
        error: `JWT role_label is not provisioned for this workspace: ${role}`,
      },
      { status: 403 },
    );
  }

  // --- Body parse ---
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const query =
    body && typeof body === "object" && "query" in body
      ? String((body as { query: unknown }).query ?? "")
      : "";
  if (!query) {
    return NextResponse.json({ error: "Missing `query` field" }, { status: 400 });
  }
  if (query.length > MAX_QUERY_CHARS) {
    return NextResponse.json(
      { error: `Query exceeds maximum length of ${MAX_QUERY_CHARS} characters` },
      { status: 413 },
    );
  }

  // --- Policy (Layer 1 + Layer 2 Claude classifier) ---
  // Regulated tenants set clients.layer2_required=true. For those we
  // refuse the request (503) rather than degrade to Layer 1 when the
  // Claude classifier is down.
  const failClosed = await getLayer2Required(claims.workspace_id);
  let decision;
  try {
    decision = await evaluateWithLLM(role, query, {
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

  // --- Re-check JWT expiry after the LLM round trip. evaluateWithLLM can
  // take several seconds against Anthropic; if the token had little life
  // left when the request started it may now be expired. Refuse rather
  // than write an audit entry under a stale identity. ---
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

  const ipAddress =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const session: SessionContext = {
    userId: `u_${role}_${claims.sub.slice(-6)}`,
    workspaceId: claims.workspace_id,
    role,
    ipAddress,
    requestId: claims.sid,
  };
  const securityContext =
    decision.decision === "ALLOW"
      ? buildSecurityContext(session, decision)
      : null;

  // --- Forensic write (server-side; service_role for cross-cutting audit) ---
  const auditWrite = await writeAuditEntry({
    request_id: session.requestId,
    workspace_id: session.workspaceId,
    user_id: session.userId,
    role: session.role,
    ip_address: session.ipAddress,
    source: "rbac",
    decision: decision.decision,
    blocked_by: decision.blockedBy?.name ?? null,
    reason: decision.reason,
    sanitized_prompt_hash: "", // filled by writer (SHA-256)
    plain_prompt_for_hash: query,
    detected_scopes: decision.classification.scopes,
    detected_actions: decision.classification.actions,
    prompt_injection_match_count:
      decision.classification.promptInjection.matched.length,
    redaction_summary: normalizeRedactionSummary({
      kind: "rbac",
      layer2_used: decision.layer2Used ? 1 : 0,
      layer2_available: decision.layer2Available ? 1 : 0,
      ...(decision.llmInjectionVerdict
        ? {
            llm_technique: decision.llmInjectionVerdict.technique,
            llm_confidence: decision.llmInjectionVerdict.confidence,
          }
        : {}),
    }),
  });

  // Fail-closed audit: a missing forensic record breaks our governance
  // promise. Refuse to return the decision (even an ALLOW) if audit write
  // failed for a real reason. `not_configured` is the demo-only escape
  // hatch — Supabase env missing means the caller knows we're in dev mode.
  if (!auditWrite.ok && auditWrite.reason !== "not_configured") {
    return NextResponse.json(
      {
        error: "Audit write failed — refusing to return policy decision.",
        detail: auditWrite.error ?? "unknown",
        request_id: session.requestId,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    decision,
    securityContext,
    session,
    audit: auditWrite,
  });
}
