import "server-only";
import { SignJWT, jwtVerify, type JWTPayload } from "jose";

/**
 * Workspace-scoped JWT for tenant runtime.
 *
 * Signed with SUPABASE_JWT_SECRET (HS256). Supabase recognizes any HS256 JWT
 * signed with that secret as a valid session, so when we attach this token
 * as a Bearer header on a Supabase client, all RLS policies that read
 * `request.jwt.claims` immediately apply.
 *
 * Claims we set:
 *   role          = 'authenticated' (so Supabase honors it)
 *   workspace_id  = the tenant the bearer is scoped to
 *   sub           = workspace_id (compatibility with auth.uid())
 *   sid           = a per-session UUID for log correlation
 *   role_label    = optional UX role (e.g. 'front_desk_agent', 'compliance_officer')
 *   iss           = 'loucels'
 *   aud           = 'workspace-runtime'
 *   iat / exp     = 5-minute TTL by default
 *
 * NEVER expose this minter to client code. It runs on the server only and
 * issues tokens after the server has already authenticated the actor (e.g.
 * verified a Twilio webhook signature, or matched a Loucels admin login).
 */

const ISSUER = "loucels";
const AUDIENCE = "workspace-runtime";
const DEFAULT_TTL_SECONDS = 300; // 5 minutes — short on purpose

function getSecret(): Uint8Array {
  const raw = process.env.SUPABASE_JWT_SECRET;
  if (!raw || raw.length < 32) {
    throw new Error(
      "SUPABASE_JWT_SECRET is missing or too short. Get it from Supabase " +
        "Project Settings → API → JWT Secret.",
    );
  }
  // Entropy floor: refuse trivially weak secrets like "aaaa...aaaa" that
  // technically pass the length check. We require at least 12 distinct
  // characters and reject single-character repetition. Real Supabase
  // secrets are base64url and easily exceed both thresholds; this only
  // catches placeholder values that slipped from a .env template into
  // production.
  const unique = new Set(raw).size;
  if (unique < 12) {
    throw new Error(
      "SUPABASE_JWT_SECRET has too little entropy (only " +
        unique +
        " distinct characters). Use the real secret from Supabase, not a placeholder.",
    );
  }
  if (/^(.)\1+$/.test(raw)) {
    throw new Error(
      "SUPABASE_JWT_SECRET is a single repeated character. Use the real secret.",
    );
  }
  return new TextEncoder().encode(raw);
}

export type WorkspaceJwtClaims = {
  workspace_id: string;
  role_label?: string;
  sid: string;
  sub: string;
  role: "authenticated";
  iss: string;
  aud: string;
  iat: number;
  exp: number;
};

export async function mintWorkspaceJwt(input: {
  workspace_id: string;
  role_label?: string;
  ttlSeconds?: number;
}): Promise<string> {
  if (!/^ws_[a-z0-9_]{3,40}$/.test(input.workspace_id)) {
    throw new Error("Invalid workspace_id format");
  }
  const sid = crypto.randomUUID();
  const ttl = input.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  const jwt = await new SignJWT({
    workspace_id: input.workspace_id,
    role: "authenticated",
    role_label: input.role_label,
    sid,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setSubject(input.workspace_id)
    .setIssuedAt()
    .setExpirationTime(`${ttl}s`)
    .sign(getSecret());
  return jwt;
}

/**
 * Verify a JWT. Throws on any failure: bad signature, expired, wrong issuer,
 * wrong audience, missing workspace_id, malformed workspace_id.
 *
 * IMPORTANT: never call `decodeJwt` (which doesn't verify) on a token before
 * passing it to a downstream Supabase client. Always go through this function.
 */
export async function verifyWorkspaceJwt(token: string): Promise<WorkspaceJwtClaims> {
  const { payload } = await jwtVerify(token, getSecret(), {
    issuer: ISSUER,
    audience: AUDIENCE,
    algorithms: ["HS256"],
  });
  const claims = payload as Partial<WorkspaceJwtClaims> & JWTPayload;
  if (typeof claims.workspace_id !== "string") {
    throw new Error("JWT missing workspace_id");
  }
  if (!/^ws_[a-z0-9_]{3,40}$/.test(claims.workspace_id)) {
    throw new Error("JWT workspace_id format invalid");
  }
  if (claims.role !== "authenticated") {
    throw new Error("JWT role must be authenticated");
  }
  return claims as WorkspaceJwtClaims;
}

/**
 * Re-check JWT expiry against the wall clock. The `jose` verifier checks
 * `exp` once at the start of the request; this helper is for routes whose
 * work runs long enough (LLM calls, external APIs, multiple DB round
 * trips) that the token could expire mid-flight. Throws if the token has
 * passed its `exp`; otherwise returns silently.
 */
export function assertJwtStillValid(claims: WorkspaceJwtClaims): void {
  const nowSec = Math.floor(Date.now() / 1000);
  if (typeof claims.exp !== "number" || claims.exp <= nowSec) {
    throw new Error("JWT expired during request handling");
  }
}

/**
 * Extract a Bearer token from an Authorization header. Returns null when
 * absent or malformed — callers decide how to handle (401 vs proceed as anon).
 */
export function extractBearerToken(req: Request): string | null {
  const auth = req.headers.get("authorization");
  if (!auth || !auth.toLowerCase().startsWith("bearer ")) return null;
  const token = auth.substring(7).trim();
  return token.length > 0 ? token : null;
}
