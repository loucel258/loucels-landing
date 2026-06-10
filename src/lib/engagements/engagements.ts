import "server-only";
import { getServiceClient } from "@/lib/audit/client";

/**
 * Engagements module — webhook-driven status transitions for sales pipeline.
 *
 * Per workflow-architect GAP-D1/D3/D5: DocuSign + Stripe + Tally events
 * arrive in Steven's inbox and he correlates eyeball-by-eyeball. These
 * helpers let inbound webhooks transition an engagement row atomically.
 */

type DocuSignUpdate = {
  envelopeId: string;
  signerEmail: string;
  event: "envelope_completed" | "envelope_declined" | "envelope_voided";
  signedAt?: string | null;
};

type StripeUpdate = {
  paymentIntentId: string;
  customerEmail: string;
  event: "payment_succeeded" | "payment_failed";
  amountCents?: number | null;
  paidAt?: string | null;
};

type TallyUpdate = {
  submissionId: string;
  respondentEmail: string;
  receivedAt?: string | null;
};

type UpdateResult =
  | { ok: true; engagementId: string; previousStatus: string; newStatus: string }
  | { ok: false; reason: "no_client" | "no_match" | "update_failed"; error?: string };

/**
 * Find an engagement by docusign envelope_id OR by signer email + status='prospect_signed_up'.
 * First match wins; if neither matches, returns null.
 */
async function findEngagementForDocuSign(
  envelopeId: string,
  signerEmail: string,
) {
  const sb = getServiceClient();
  if (!sb) return null;

  const byEnvId = await sb
    .from("engagements")
    .select("id, status")
    .eq("docusign_envelope_id", envelopeId)
    .limit(1)
    .maybeSingle();
  if (byEnvId.data) return byEnvId.data;

  const byEmail = await sb
    .from("engagements")
    .select("id, status")
    .eq("client_email", signerEmail.toLowerCase())
    .eq("status", "prospect_signed_up")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return byEmail.data ?? null;
}

export async function applyDocuSignWebhook(
  input: DocuSignUpdate,
): Promise<UpdateResult> {
  const sb = getServiceClient();
  if (!sb) return { ok: false, reason: "no_client" };

  const eng = await findEngagementForDocuSign(input.envelopeId, input.signerEmail);
  if (!eng) return { ok: false, reason: "no_match" };

  const newStatus =
    input.event === "envelope_completed"
      ? "sow_signed"
      : "sow_voided";

  const update: Record<string, unknown> = {
    status: newStatus,
    docusign_envelope_id: input.envelopeId,
  };
  if (input.event === "envelope_completed") {
    update.docusign_signed_at = input.signedAt ?? new Date().toISOString();
  } else {
    update.docusign_voided_at = new Date().toISOString();
    update.outcome_at = new Date().toISOString();
  }

  const { error } = await sb.from("engagements").update(update).eq("id", eng.id);
  if (error) {
    return { ok: false, reason: "update_failed", error: error.message };
  }
  return {
    ok: true,
    engagementId: eng.id,
    previousStatus: eng.status,
    newStatus,
  };
}

async function findEngagementForStripe(
  paymentIntentId: string,
  customerEmail: string,
) {
  const sb = getServiceClient();
  if (!sb) return null;

  const byPi = await sb
    .from("engagements")
    .select("id, status")
    .eq("stripe_payment_intent_id", paymentIntentId)
    .limit(1)
    .maybeSingle();
  if (byPi.data) return byPi.data;

  // Best-effort: match by email + 'sow_signed' state (most likely to be paid)
  const byEmail = await sb
    .from("engagements")
    .select("id, status")
    .eq("client_email", customerEmail.toLowerCase())
    .in("status", ["sow_signed", "prospect_signed_up"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return byEmail.data ?? null;
}

export async function applyStripeWebhook(
  input: StripeUpdate,
): Promise<UpdateResult> {
  const sb = getServiceClient();
  if (!sb) return { ok: false, reason: "no_client" };

  const eng = await findEngagementForStripe(input.paymentIntentId, input.customerEmail);
  if (!eng) return { ok: false, reason: "no_match" };

  const newStatus =
    input.event === "payment_succeeded" ? "paid" : "payment_failed";

  const update: Record<string, unknown> = {
    status: newStatus,
    stripe_payment_intent_id: input.paymentIntentId,
    stripe_amount_paid_cents: input.amountCents ?? null,
  };
  if (input.event === "payment_succeeded") {
    update.stripe_paid_at = input.paidAt ?? new Date().toISOString();
  } else {
    update.outcome_at = new Date().toISOString();
  }

  const { error } = await sb.from("engagements").update(update).eq("id", eng.id);
  if (error) {
    return { ok: false, reason: "update_failed", error: error.message };
  }
  return {
    ok: true,
    engagementId: eng.id,
    previousStatus: eng.status,
    newStatus,
  };
}

export async function applyTallyWebhook(
  input: TallyUpdate,
): Promise<UpdateResult> {
  const sb = getServiceClient();
  if (!sb) return { ok: false, reason: "no_client" };

  // Match by respondent email + recent status (paid is the expected state
  // when intake form is sent)
  const byEmail = await sb
    .from("engagements")
    .select("id, status")
    .eq("client_email", input.respondentEmail.toLowerCase())
    .in("status", ["paid", "sow_signed"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const eng = byEmail.data;
  if (!eng) return { ok: false, reason: "no_match" };

  const { error } = await sb
    .from("engagements")
    .update({
      status: "intake_received",
      tally_submission_id: input.submissionId,
      intake_received_at: input.receivedAt ?? new Date().toISOString(),
    })
    .eq("id", eng.id);

  if (error) {
    return { ok: false, reason: "update_failed", error: error.message };
  }
  return {
    ok: true,
    engagementId: eng.id,
    previousStatus: eng.status,
    newStatus: "intake_received",
  };
}
