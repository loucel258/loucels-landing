import "server-only";

/**
 * Process-local token bucket rate limiter. Best-effort only — on a
 * multi-instance deploy each instance has its own bucket and an
 * attacker hitting multiple regions can exceed the per-instance cap.
 * That's acceptable for the demo's threat model (defense in depth on
 * top of JWT auth, not the primary control); a real production cutover
 * should swap this for a Redis/Upstash bucket keyed identically.
 *
 * Limits are deliberately permissive enough not to interfere with
 * normal demo usage and tight enough to stop a script from emptying
 * our Anthropic budget.
 */

type Bucket = {
  tokens: number;
  lastRefill: number;
};

const buckets = new Map<string, Bucket>();

// Periodic GC so the Map doesn't grow unbounded under attack.
const GC_INTERVAL_MS = 5 * 60_000;
let lastGc = Date.now();

function gc(now: number) {
  if (now - lastGc < GC_INTERVAL_MS) return;
  for (const [k, b] of buckets) {
    if (now - b.lastRefill > 10 * 60_000) buckets.delete(k);
  }
  lastGc = now;
}

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterSec: number;
};

/**
 * Check + decrement the bucket for `key`. Returns `allowed=false` when
 * the caller exceeded the cap; otherwise returns the remaining tokens.
 *
 * @param key      stable identity for the caller — typically
 *                 `${route}:${ip}` or `${route}:${workspace_id}`.
 * @param capacity max tokens in the bucket (= burst size).
 * @param refillPerSec how many tokens are added per second.
 */
export function rateLimit(
  key: string,
  capacity: number,
  refillPerSec: number,
): RateLimitResult {
  const now = Date.now();
  gc(now);

  let b = buckets.get(key);
  if (!b) {
    b = { tokens: capacity, lastRefill: now };
    buckets.set(key, b);
  }

  // Refill based on elapsed time.
  const elapsedSec = (now - b.lastRefill) / 1000;
  if (elapsedSec > 0) {
    b.tokens = Math.min(capacity, b.tokens + elapsedSec * refillPerSec);
    b.lastRefill = now;
  }

  if (b.tokens >= 1) {
    b.tokens -= 1;
    return {
      allowed: true,
      remaining: Math.floor(b.tokens),
      retryAfterSec: 0,
    };
  }

  // Time until we accumulate 1 token again.
  const retryAfterSec = Math.ceil((1 - b.tokens) / refillPerSec);
  return { allowed: false, remaining: 0, retryAfterSec };
}

/**
 * Derive a stable client key from a Request. Prefers x-forwarded-for,
 * falls back to the JWT workspace_id if provided, otherwise a literal
 * "unknown" bucket (which all anon callers share — intentionally
 * hostile).
 */
export function clientKey(req: Request, workspaceId?: string): string {
  const xff = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (xff) return `ip:${xff}`;
  if (workspaceId) return `ws:${workspaceId}`;
  return "anon";
}
