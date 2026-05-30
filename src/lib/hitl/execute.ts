import "server-only";

/**
 * Mock external execution layer. In production this routes to:
 *   send_quote / send_refund / send_message → Twilio / Stripe / Postmark
 *   reply_review                            → Google Business Profile API
 *
 * For the demo we simulate the call with random latency. The `force_fail`
 * flag flips the result so a sales demo can show the saga rollback path on
 * cue ("now watch what happens when Twilio is down").
 *
 * HARD TIMEOUT + IDEMPOTENCY
 * --------------------------
 * The caller passes a `timeout_ms` (defaults to 8s) and an
 * `idempotency_key` (the pending_approvals.id). The timeout caps every
 * provider call so a hanging external API can't leave the saga stuck in
 * `approving` forever — the migration 015 sweeper is the backstop, this
 * is the inner guard. The idempotency_key would be forwarded to Twilio's
 * `Idempotency-Key` header, Stripe's `Idempotency-Key`, etc. so that a
 * retry after a timeout doesn't double-send/double-charge.
 */

export type ExecutionResult = {
  ok: boolean;
  provider: string;
  external_id?: string;
  failure_reason?: string;
};

const PROVIDER_BY_ACTION: Record<string, string> = {
  send_quote: "twilio",
  send_refund: "stripe",
  reply_review: "google_business_profile",
  send_message: "twilio",
};

const DEFAULT_TIMEOUT_MS = 8_000;

export async function executeExternal({
  action_type,
  force_fail = false,
  timeout_ms = DEFAULT_TIMEOUT_MS,
  idempotency_key,
}: {
  action_type: string;
  recipient: string | null;
  final_text: string;
  force_fail?: boolean;
  timeout_ms?: number;
  idempotency_key: string;
}): Promise<ExecutionResult> {
  const provider = PROVIDER_BY_ACTION[action_type] ?? "unknown_provider";

  // Simulated provider call. In production this is fetch() to Twilio/
  // Stripe/GBP with `Idempotency-Key: ${idempotency_key}` in the headers
  // so retries are safe.
  const providerCall = new Promise<ExecutionResult>(async (resolve) => {
    await new Promise((r) => setTimeout(r, 200 + Math.random() * 300));
    if (force_fail) {
      resolve({
        ok: false,
        provider,
        failure_reason:
          "Simulated external API failure (force_fail=true). In production this would be HTTP 500 from the provider, a timeout, or a quota/auth error.",
      });
      return;
    }
    resolve({
      ok: true,
      provider,
      // Deterministic external_id derived from idempotency_key so retries
      // surface the same id (mirrors what Twilio/Stripe do internally).
      external_id: `${provider}_${idempotency_key.slice(0, 12)}`,
    });
  });

  // Race the provider against a hard timeout. If the provider hangs, we
  // resolve with a failure so the saga can roll back instead of dangling.
  const timeoutPromise = new Promise<ExecutionResult>((resolve) => {
    setTimeout(() => {
      resolve({
        ok: false,
        provider,
        failure_reason: `external_call_timeout: provider did not respond within ${timeout_ms}ms (idempotency_key=${idempotency_key})`,
      });
    }, timeout_ms);
  });

  return Promise.race([providerCall, timeoutPromise]);
}
