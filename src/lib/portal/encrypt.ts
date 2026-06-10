import "server-only";
import crypto from "node:crypto";

/**
 * AES-256-GCM envelope for conversation_messages.
 *
 * Format:
 *   base64( iv[12 bytes] || authTag[16 bytes] || ciphertext )
 *
 * Key derivation:
 *   scrypt(CONVERSATION_ENCRYPTION_KEY, `conv_v1::${engagementId}`, 32)
 *
 * Implication: rotating CONVERSATION_ENCRYPTION_KEY rotates EVERY
 * engagement's key. Per-engagement salt means a leak of one engagement's
 * derived key (extremely unlikely — never persisted) cannot decrypt other
 * engagements. In v2 we'll layer per-engagement KMS keys.
 *
 * Throws when the master key is missing rather than degrading to
 * plaintext. The chat route catches the throw and falls back to "do not
 * persist transcript" so a missing key never breaks user-facing flow.
 */

const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;

function masterKey(): Buffer {
  const raw = process.env.CONVERSATION_ENCRYPTION_KEY;
  if (!raw || raw.length < 32) {
    throw new Error("CONVERSATION_ENCRYPTION_KEY missing or < 32 chars");
  }
  return Buffer.from(raw, "utf8");
}

function deriveKey(engagementId: string): Buffer {
  return crypto.scryptSync(masterKey(), `conv_v1::${engagementId}`, 32);
}

export function encryptMessage(engagementId: string, plaintext: string): string {
  const key = deriveKey(engagementId);
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

export function decryptMessage(engagementId: string, cipherB64: string): string {
  const buf = Buffer.from(cipherB64, "base64");
  if (buf.length < IV_LEN + TAG_LEN + 1) {
    throw new Error("ciphertext too short");
  }
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ct = buf.subarray(IV_LEN + TAG_LEN);
  const key = deriveKey(engagementId);
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(ct), decipher.final()]);
  return dec.toString("utf8");
}

export function encryptionAvailable(): boolean {
  const raw = process.env.CONVERSATION_ENCRYPTION_KEY;
  return !!raw && raw.length >= 32;
}
