import "server-only";
import { cookies } from "next/headers";
import crypto from "node:crypto";

/**
 * Client Portal auth — per-client passcode + signed session cookie.
 *
 * Each engagement provisions one row in `client_portal_access` with a
 * scrypt-hashed passcode. When the client enters their passcode at
 * `/portal/[slug]/login`, we verify, mint a session token scoped to that
 * slug, and set a cookie named `loucels_portal_<slug>`.
 *
 * Sessions:
 *   - HMAC-signed (`iat.nonce.sig`) like the admin auth
 *   - Key derived from PORTAL_SESSION_SECRET + slug so a leaked cookie
 *     for client A cannot impersonate client B
 *   - 7-day TTL (vs 8h for admin) since clients log in less often
 */

const SESSION_TTL_SEC = 60 * 60 * 24 * 7;
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEY_LEN = 32;

export function cookieName(slug: string): string {
  return `loucels_portal_${slug}`;
}

function sessionKey(slug: string): Buffer | null {
  const baseSecret = process.env.PORTAL_SESSION_SECRET ?? process.env.ADMIN_DASHBOARD_PASSWORD;
  if (!baseSecret) return null;
  return crypto.scryptSync(baseSecret, `portal_v1_${slug}`, 32);
}

function sign(payload: string, key: Buffer): string {
  return crypto.createHmac("sha256", key).update(payload).digest("base64url");
}

function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

export function hashPasscode(passcode: string, saltHex: string): string {
  const salt = Buffer.from(saltHex, "hex");
  const derived = crypto.scryptSync(passcode, salt, SCRYPT_KEY_LEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
  return derived.toString("hex");
}

export function generatePasscodeSalt(): string {
  return crypto.randomBytes(16).toString("hex");
}

export function verifyPasscode(passcode: string, storedHashHex: string, saltHex: string): boolean {
  const candidate = hashPasscode(passcode, saltHex);
  return constantTimeEqual(candidate, storedHashHex);
}

export function mintPortalSession(slug: string): string | null {
  const key = sessionKey(slug);
  if (!key) return null;
  const iat = Math.floor(Date.now() / 1000);
  const nonce = crypto.randomBytes(12).toString("base64url");
  const payload = `${iat}.${nonce}`;
  const sig = sign(payload, key);
  return `${payload}.${sig}`;
}

function verifyPortalSession(slug: string, token: string): boolean {
  const key = sessionKey(slug);
  if (!key) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [iatStr, nonce, sig] = parts as [string, string, string];
  const expected = sign(`${iatStr}.${nonce}`, key);
  if (!constantTimeEqual(sig, expected)) return false;
  const iat = Number.parseInt(iatStr, 10);
  if (!Number.isFinite(iat)) return false;
  const age = Math.floor(Date.now() / 1000) - iat;
  return age >= 0 && age <= SESSION_TTL_SEC;
}

export async function isPortalAuthed(slug: string): Promise<boolean> {
  const jar = await cookies();
  const value = jar.get(cookieName(slug))?.value;
  if (!value) return false;
  return verifyPortalSession(slug, value);
}

export function portalCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    maxAge: SESSION_TTL_SEC,
    path: "/",
  };
}
