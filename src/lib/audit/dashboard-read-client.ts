import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SignJWT } from "jose";
import { getServiceClient } from "./client";

/**
 * Read-only Supabase client backed by the `loucels_dashboard_read`
 * Postgres role (migration 029 + 030). Closes F11 from the security
 * audit — admin dashboard reads no longer require service-role.
 *
 * How it works:
 *   1. Sign a short-lived JWT with `role: "loucels_dashboard_read"` using
 *      the project's Supabase JWT secret.
 *   2. Pass it as the Authorization header on a fresh Supabase JS client.
 *   3. PostgREST authenticates as `authenticator`, sees the role claim,
 *      and SET ROLEs into `loucels_dashboard_read` for the connection.
 *
 * Result: even if the dashboard's process is compromised, it can only
 * SELECT — never INSERT/UPDATE/DELETE. The service-role key is still
 * needed for writers (chat audit, webhooks, lead inserts) but is no
 * longer the only credential the read path holds.
 *
 * Fallback: when SUPABASE_JWT_SECRET is unset (local dev before Vercel
 * is wired) we fall back to the service-role client. The fallback is
 * logged on first use so it can't sneak into production silently.
 */

const ROLE = "loucels_dashboard_read";
const TOKEN_TTL_SEC = 60 * 60; // 1 hour — refreshed each request anyway
let fallbackLogged = false;

async function mintReadJwt(secret: string): Promise<string> {
  const key = new TextEncoder().encode(secret);
  return await new SignJWT({ role: ROLE })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + TOKEN_TTL_SEC)
    .sign(key);
}

/**
 * Returns a Supabase client that PostgREST will execute as the read-only
 * role. Each call mints a fresh JWT so a single request never holds a
 * long-lived token. The cost (HS256 signing) is sub-millisecond.
 */
export async function getDashboardReadClient(): Promise<SupabaseClient | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const jwtSecret = process.env.SUPABASE_JWT_SECRET;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url) return null;

  if (!jwtSecret || !anonKey) {
    if (!fallbackLogged) {
      // eslint-disable-next-line no-console
      console.warn(
        "[dashboard-read] SUPABASE_JWT_SECRET or NEXT_PUBLIC_SUPABASE_ANON_KEY missing — falling back to service-role for admin reads. F11 is not closed in this environment.",
      );
      fallbackLogged = true;
    }
    return getServiceClient();
  }

  const token = await mintReadJwt(jwtSecret);
  // anonKey is the apikey that PostgREST checks first; the JWT then
  // upgrades the request to the role. Both are required.
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}
