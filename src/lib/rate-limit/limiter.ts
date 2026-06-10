import "server-only";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

/**
 * Rate limiter with two backends:
 *
 *   1. Upstash Redis (production) — distributed token bucket shared by
 *      every serverless instance. Active when UPSTASH_REDIS_REST_URL +
 *      UPSTASH_REDIS_REST_TOKEN are set.
 *   2. Process-local token bucket (dev / fallback) — same semantics but
 *      per-instance. On a multi-instance deploy an attacker rotating
 *      regions can multiply the cap by the instance count, so this is
 *      NOT acceptable as the only brake in production.
 *
 * If Upstash is configured but a call to it fails (network blip), we
 * fall back to the local bucket for that request rather than failing
 * open entirely — availability over strictness, with a floor.
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

// ---------------------------------------------------------------------------
// Upstash backend
// ---------------------------------------------------------------------------

let redis: Redis | null | undefined;
function getRedis(): Redis | null {
  if (redis !== undefined) return redis;
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    redis = Redis.fromEnv();
  } else {
    redis = null;
    if (process.env.NODE_ENV === "production") {
      // eslint-disable-next-line no-console
      console.warn(
        "[rate-limit] Upstash not configured — falling back to per-instance buckets. " +
          "Set UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN before real traffic.",
      );
    }
  }
  return redis;
}

// One Ratelimit instance per (capacity, refill) config. Instances are
// lightweight wrappers; the Map stays tiny because configs are static
// per route.
const limiters = new Map<string, Ratelimit>();
function getLimiter(capacity: number, refillPerSec: number): Ratelimit | null {
  const r = getRedis();
  if (!r) return null;
  const cfgKey = `${capacity}:${refillPerSec}`;
  let limiter = limiters.get(cfgKey);
  if (!limiter) {
    // Convert refill/sec to tokens-per-minute for Upstash's token bucket.
    // All current configs are sub-1/sec, so per-minute keeps integer rates.
    const perMinute = Math.max(1, Math.round(refillPerSec * 60));
    limiter = new Ratelimit({
      redis: r,
      limiter: Ratelimit.tokenBucket(perMinute, "60 s", capacity),
      prefix: "rl",
    });
    limiters.set(cfgKey, limiter);
  }
  return limiter;
}

// ---------------------------------------------------------------------------
// Local fallback backend (previous implementation, unchanged semantics)
// ---------------------------------------------------------------------------

function rateLimitLocal(
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

  const retryAfterSec = Math.ceil((1 - b.tokens) / refillPerSec);
  return { allowed: false, remaining: 0, retryAfterSec };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Check + decrement the bucket for `key`. Returns `allowed=false` when
 * the caller exceeded the cap; otherwise returns the remaining tokens.
 *
 * @param key      stable identity for the caller — typically
 *                 `${route}:${ip}` or `${route}:${workspace_id}`.
 * @param capacity max tokens in the bucket (= burst size).
 * @param refillPerSec how many tokens are added per second.
 */
export async function rateLimit(
  key: string,
  capacity: number,
  refillPerSec: number,
): Promise<RateLimitResult> {
  const limiter = getLimiter(capacity, refillPerSec);
  if (limiter) {
    try {
      const res = await limiter.limit(key);
      return {
        allowed: res.success,
        remaining: res.remaining,
        retryAfterSec: res.success
          ? 0
          : Math.max(1, Math.ceil((res.reset - Date.now()) / 1000)),
      };
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[rate-limit] Upstash error, using local fallback:", err);
    }
  }
  return rateLimitLocal(key, capacity, refillPerSec);
}

/**
 * Derive a stable client key from a Request. Uses the LAST entry of
 * x-forwarded-for — the hop observed by our proxy. The FIRST entry is
 * attacker-controlled and must never be used as an identity.
 */
export function clientKey(req: Request, workspaceId?: string): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const parts = xff.split(",").map((p) => p.trim()).filter(Boolean);
    if (parts.length > 0) return `ip:${parts[parts.length - 1]}`;
  }
  if (workspaceId) return `ws:${workspaceId}`;
  return "anon";
}
