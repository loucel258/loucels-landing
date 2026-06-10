import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The 3 headline ROI metrics for the client Resumen.
 *
 *   1. leadsProcessed  — distinct session_ids in audit_logs (7d)
 *   2. bookings        — leads with booking_status='confirmed' tied to this
 *                        engagement (7d)
 *   3. hoursRecovered  — leadsProcessed × minutes_saved_per_conversation / 60
 *
 * Designed to be UNAMBIGUOUSLY in the client's favor. The audit
 * decisions, costs, DLP blocks etc. live elsewhere (Configuración).
 */

export type RoiMetrics = {
  leadsProcessed: number;
  bookings: number;
  hoursRecovered: number;
  minutesPerConv: number;
  windowDays: number;
};

export async function getRoiMetrics(
  sb: SupabaseClient,
  args: {
    engagementId: string;
    workspaceIds: string[];
    minutesPerConv: number;
    windowDays?: number;
  },
): Promise<RoiMetrics> {
  const windowDays = args.windowDays ?? 7;
  const since = new Date(Date.now() - windowDays * 86400_000).toISOString();

  if (args.workspaceIds.length === 0) {
    return { leadsProcessed: 0, bookings: 0, hoursRecovered: 0, minutesPerConv: args.minutesPerConv, windowDays };
  }

  const [auditRes, bookingsRes] = await Promise.all([
    sb
      .from("audit_logs")
      .select("user_id")
      .in("workspace_id", args.workspaceIds)
      .gte("inserted_at", since)
      .limit(5000),
    sb
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("booking_status", "confirmed")
      .eq("engagement_id", args.engagementId)
      .gte("confirmed_at", since),
  ]);

  const sessions = new Set<string>();
  for (const r of (auditRes.data as Array<{ user_id: string | null }>) ?? []) {
    if (r.user_id) sessions.add(r.user_id);
  }

  const leadsProcessed = sessions.size;
  const bookings = bookingsRes.count ?? 0;
  const hoursRecovered = (leadsProcessed * args.minutesPerConv) / 60;

  return { leadsProcessed, bookings, hoursRecovered, minutesPerConv: args.minutesPerConv, windowDays };
}
