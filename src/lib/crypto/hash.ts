import { createHash } from "node:crypto";

/**
 * Cryptographic primitives for the audit trail.
 *
 * SHA-256: 256-bit cryptographic hash, NIST FIPS 180-4 approved. Used here
 * for:
 *   - sanitized_prompt_hash: stable identifier for cross-referencing without
 *     storing the raw prompt.
 *   - prev_row_hash chaining: each row records the hash of (prev_row.prev_row_hash
 *     || canonical_form(this_row)). Breaking the chain detects out-of-band
 *     tampering even if a malicious actor circumvents the trigger.
 *
 * Replaces FNV-1a, which was a fast non-cryptographic hash used in the
 * initial demo. FNV is fine for stable IDs in trusted contexts but offers
 * zero collision resistance against an adversary. Audit logs require both.
 */

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/**
 * Compute the chain hash for a new audit row.
 *
 * input = previous row's prev_row_hash (or '' for the first row) +
 *         canonical form of the current row (sorted keys, stable order).
 *
 * The result becomes this row's prev_row_hash. An auditor can verify the
 * full chain by recomputing each link. A tampered row breaks all subsequent
 * hashes.
 */
export function computeChainHash(
  previousChainHash: string | null,
  currentRow: Record<string, unknown>,
): string {
  const canonical = canonicalize(currentRow);
  const seed = `${previousChainHash ?? ""}|${canonical}`;
  return sha256Hex(seed);
}

/**
 * Stable, deterministic JSON serialization for chain hashing.
 * Keys are sorted alphabetically; undefined values are omitted; arrays
 * preserve order.
 */
function canonicalize(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return "[" + value.map((v) => canonicalize(v)).join(",") + "]";
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return (
      "{" +
      entries
        .map(([k, v]) => JSON.stringify(k) + ":" + canonicalize(v))
        .join(",") +
      "}"
    );
  }
  return "null";
}
