#!/usr/bin/env node
/*
 * Provision a client portal access row.
 *
 *   node scripts/provision-portal.mjs \
 *     --slug acme-medspa \
 *     --engagement-id 74eabd31-170c-4721-b44d-5a0fb33fd6cb \
 *     --name "ACME Med Spa"
 *
 * Uses the same scrypt parameters as src/lib/portal/auth.ts. Rotates the
 * passcode if the slug already exists (UPDATE), else inserts a new row.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const SCRYPT_KEY_LEN = 32;
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    if (k.startsWith("--")) {
      out[k.slice(2)] = argv[i + 1];
      i++;
    }
  }
  return out;
}

function generatePasscode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.randomBytes(16);
  let out = "";
  for (let i = 0; i < 16; i++) out += alphabet[bytes[i] % alphabet.length];
  return `${out.slice(0, 4)}-${out.slice(4, 8)}-${out.slice(8, 12)}-${out.slice(12, 16)}`;
}

function hashPasscode(passcode, saltHex) {
  return crypto
    .scryptSync(passcode, Buffer.from(saltHex, "hex"), SCRYPT_KEY_LEN, {
      N: SCRYPT_N,
      r: SCRYPT_R,
      p: SCRYPT_P,
    })
    .toString("hex");
}

function loadEnvLocal() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const envPath = path.resolve(here, "..", ".env.local");
  const text = fs.readFileSync(envPath, "utf-8");
  return Object.fromEntries(
    text
      .split("\n")
      .filter((l) => l && !l.startsWith("#"))
      .map((l) => {
        const i = l.indexOf("=");
        return [l.slice(0, i), l.slice(i + 1).trim()];
      }),
  );
}

const args = parseArgs(process.argv);
const slug = args.slug;
const engagementId = args["engagement-id"];
const displayName = args.name;

if (!slug || !engagementId || !displayName) {
  console.error("Usage: node scripts/provision-portal.mjs --slug <slug> --engagement-id <uuid> --name \"<display name>\"");
  process.exit(2);
}
if (!/^[a-z0-9-]+$/.test(slug)) {
  console.error("Invalid slug: lowercase letters, digits, and dashes only.");
  process.exit(2);
}

const env = loadEnvLocal();
if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(2);
}
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const passcode = generatePasscode();
const salt = crypto.randomBytes(16).toString("hex");
const hash = hashPasscode(passcode, salt);

// Try UPDATE first (rotate existing). If 0 rows match, INSERT a new row.
const { data: updated, error: updateErr } = await sb
  .from("client_portal_access")
  .update({ passcode_hash: hash, passcode_salt: salt, active: true, revoked_at: null, display_name: displayName })
  .eq("client_slug", slug)
  .select("id");

if (updateErr) {
  console.error("UPDATE failed:", updateErr.message);
  process.exit(1);
}

let rowId;
if (updated && updated.length > 0) {
  rowId = updated[0].id;
  console.log(`✓ Rotated existing passcode for slug=${slug}`);
} else {
  const { data: inserted, error: insertErr } = await sb
    .from("client_portal_access")
    .insert({
      engagement_id: engagementId,
      client_slug: slug,
      passcode_hash: hash,
      passcode_salt: salt,
      display_name: displayName,
      active: true,
    })
    .select("id")
    .single();
  if (insertErr) {
    console.error("INSERT failed:", insertErr.message);
    process.exit(1);
  }
  rowId = inserted.id;
  console.log(`✓ Created portal access for slug=${slug}`);
}

console.log(`  row_id:    ${rowId}`);
console.log(`  passcode:  ${passcode}`);
console.log(`  URL:       https://loucels.com/portal/${slug}  (or http://localhost:3000/portal/${slug} for dev)`);
console.log("\nGive the passcode to the client securely. We do not store it in plaintext.");
