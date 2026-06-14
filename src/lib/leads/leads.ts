import "server-only";
import { getServiceClient } from "@/lib/audit/client";

/**
 * Lead capture — the only place visitor PII (name+email) lives as plaintext.
 *
 * Per the workflow-architect report (GAP-B5 + GAP-C1), the chat agent used
 * to send name+email+reason to Cal.com via deep-link URL and persist NONE
 * of it server-side. If the visitor abandoned the Cal.com form, the lead
 * vanished. This module writes the lead the moment `request_booking` fires,
 * and exposes update helpers for the Cal.com webhook to confirm / cancel /
 * reschedule the booking.
 *
 * Failures are non-fatal — a Supabase blip must not break a discovery call.
 * If Supabase is unconfigured (no service-role key in env), the helpers
 * return `{ok: false}` and the chat continues. This is intentional during
 * staging / before migration 021 runs.
 */

export type LeadInsertInput = {
  sessionId: string;
  auditRequestId: string;
  name: string;
  email: string;
  reason: string;
  preferredWindow?: string | null;
  bookingLink: string;
  source?: "chat_widget" | "footer_cta" | "template_card" | "contact_form" | "other";
  ip?: string | null;
  /**
   * Multi-tenant scoping. Populated by /api/agent/[slug]/chat from the
   * resolved agent's engagement_id. Leaving this undefined produces a
   * Loucells Core-landing lead (legacy chat route).
   */
  engagementId?: string | null;
};

export type LeadInsertResult =
  | { ok: true; leadId: string }
  | { ok: false; reason: "no_client" | "insert_failed"; error?: string };

function normalizeIp(ip: string | null | undefined): string | null {
  if (!ip) return null;
  const trimmed = ip.trim();
  if (!trimmed || trimmed === "unknown") return null;
  return trimmed;
}

/**
 * Insert a new lead row when the chat's request_booking tool fires.
 * Returns the new leadId on success so the caller can correlate downstream
 * audit events (and the eventual Cal.com webhook can update by lead id
 * OR by cal_event_id when Cal.com sends it back).
 */
export async function insertLead(
  input: LeadInsertInput,
): Promise<LeadInsertResult> {
  const sb = getServiceClient();
  if (!sb) return { ok: false, reason: "no_client" };

  const { data, error } = await sb
    .from("leads")
    .insert({
      session_id: input.sessionId,
      audit_request_id: input.auditRequestId,
      name: input.name,
      email: input.email,
      reason: input.reason,
      preferred_window: input.preferredWindow ?? null,
      booking_link: input.bookingLink,
      booking_status: "offered",
      source: input.source ?? "chat_widget",
      ip_address: normalizeIp(input.ip),
      engagement_id: input.engagementId ?? null,
    })
    .select("id")
    .single();

  if (error) {
    // eslint-disable-next-line no-console
    console.warn("[leads] insert failed:", error.message);
    return { ok: false, reason: "insert_failed", error: error.message };
  }
  return { ok: true, leadId: data.id };
}

/**
 * Update a lead's status when Cal.com webhook fires. Matches by:
 *   1. `cal_event_id` if known (most reliable)
 *   2. else by `email` + `booking_status='offered'` + most recent (best-effort)
 *
 * Both lookup paths are used because BOOKING_CREATED webhooks may arrive
 * BEFORE we've stored the cal_event_id (since Loucells Core never saw the booking
 * happen until Cal.com tells us about it).
 */
export type WebhookUpdateInput = {
  triggerEvent:
    | "BOOKING_CREATED"
    | "BOOKING_RESCHEDULED"
    | "BOOKING_CANCELLED";
  email: string;
  calEventId: string;
  slotIso?: string | null;
};

export type WebhookUpdateResult =
  | { ok: true; leadId: string; previousStatus: string }
  | { ok: false; reason: "no_client" | "no_match" | "update_failed"; error?: string };

export async function applyCalWebhook(
  input: WebhookUpdateInput,
): Promise<WebhookUpdateResult> {
  const sb = getServiceClient();
  if (!sb) return { ok: false, reason: "no_client" };

  // First try to find by cal_event_id (if a prior webhook already stored it)
  // Pull reschedule_count too so we can increment on RESCHEDULED.
  const byCalId = await sb
    .from("leads")
    .select("id, booking_status, reschedule_count")
    .eq("cal_event_id", input.calEventId)
    .limit(1)
    .maybeSingle();

  let leadId: string | null = byCalId.data?.id ?? null;
  let previousStatus: string = byCalId.data?.booking_status ?? "offered";
  let previousRescheduleCount: number =
    (byCalId.data?.reschedule_count as number | undefined) ?? 0;

  // Fall back to email + offered status (most recent first)
  if (!leadId) {
    const byEmail = await sb
      .from("leads")
      .select("id, booking_status, reschedule_count")
      .eq("email", input.email.toLowerCase())
      .eq("booking_status", "offered")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    leadId = byEmail.data?.id ?? null;
    previousStatus = byEmail.data?.booking_status ?? "offered";
    previousRescheduleCount =
      (byEmail.data?.reschedule_count as number | undefined) ?? 0;
  }

  if (!leadId) return { ok: false, reason: "no_match" };

  const newStatus =
    input.triggerEvent === "BOOKING_CREATED"
      ? "confirmed"
      : input.triggerEvent === "BOOKING_RESCHEDULED"
        ? "rescheduled"
        : "cancelled";

  const update: Record<string, unknown> = {
    booking_status: newStatus,
    cal_event_id: input.calEventId,
  };
  if (input.slotIso) update.booking_slot_iso = input.slotIso;
  if (input.triggerEvent === "BOOKING_CREATED") {
    update.confirmed_at = new Date().toISOString();
  }
  // GAP-C3 closure: track reschedule count so the alert cron can ping
  // Steven when a lead has rescheduled 3+ times (probable ghost).
  if (input.triggerEvent === "BOOKING_RESCHEDULED") {
    update.reschedule_count = previousRescheduleCount + 1;
  }

  const { error } = await sb.from("leads").update(update).eq("id", leadId);

  if (error) {
    // eslint-disable-next-line no-console
    console.warn("[leads] cal webhook update failed:", error.message);
    return { ok: false, reason: "update_failed", error: error.message };
  }
  return { ok: true, leadId, previousStatus };
}
