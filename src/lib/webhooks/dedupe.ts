import "server-only";
import { getServiceClient } from "@/lib/audit/client";

export type WebhookSource = "cal" | "docusign" | "tally" | "stripe";

/**
 * Try to claim a webhook (source, event_id) pair. Returns true if this is
 * the first time we see it (caller proceeds), false if already processed
 * (caller should ACK 200 and stop). When Supabase is not configured we
 * fail open so dev/test does not require the DB.
 */
export async function claimWebhook(
  source: WebhookSource,
  eventId: string,
): Promise<boolean> {
  const sb = getServiceClient();
  if (!sb) return true;
  const { error } = await sb
    .from("webhook_seen")
    .insert({ source, event_id: eventId });
  if (!error) return true;
  // 23505 = unique_violation = duplicate event.
  if ((error as { code?: string }).code === "23505") return false;
  // eslint-disable-next-line no-console
  console.warn("[webhook-dedupe] insert failed:", error.message);
  // Fail open on transient DB errors so a Supabase blip does not drop a
  // valid event; the upstream handler is idempotent by business key.
  return true;
}
