export type EngagementRow = {
  id: string;
  engagement_ref: string;
  account_id: string | null;
  lead_id: string | null;
  client_legal_name: string;
  client_email: string;
  vertical: string | null;
  language: string;
  engagement_type: string;
  status: string;
  audit_fee_cents: number;
  stripe_payment_intent_id: string | null;
  stripe_paid_at: string | null;
  stripe_amount_paid_cents: number | null;
  docusign_envelope_id: string | null;
  docusign_sent_at: string | null;
  docusign_signed_at: string | null;
  docusign_voided_at: string | null;
  tally_submission_id: string | null;
  intake_received_at: string | null;
  created_at: string;
  kickoff_at: string | null;
  delivered_at: string | null;
  walkthrough_at: string | null;
  outcome_at: string | null;
  notes: string | null;
  credit_amount_cents: number;
  credit_applied_to_build_ref: string | null;
  credit_expires_at: string | null;
};

export type LeadRow = {
  id: string;
  session_id: string;
  name: string;
  email: string;
  reason: string;
  booking_status: string;
  booking_slot_iso: string | null;
  booking_link: string;
  created_at: string;
  confirmed_at: string | null;
  source: string;
};

export type AgentRow = {
  id: string;
  name: string;
  agent_type: string;
  status: string;
  workspace_id: string;
  monthly_retainer_cents: number;
  retainer_active: boolean;
  live_started_at: string | null;
};

export type AuditLogRow = {
  id: string;
  inserted_at: string;
  decision: string;
  blocked_by: string | null;
  reason: string | null;
  source: string;
  user_id: string | null;
  token_usage_in: number | null;
  token_usage_out: number | null;
};

export type PendingApprovalRow = {
  id: string;
  workspace_id: string;
  created_at: string;
  decided_at: string | null;
  proposer_id: string;
  action_type: string;
  recipient: string | null;
  proposed_text: string;
  edited_text: string | null;
  status: string;
  decider_id: string | null;
  decision_reason: string | null;
  risk_score: number | null;
  risk_flags: string[];
};

export type IncidentRow = {
  id: string;
  created_at: string;
  resolved_at: string | null;
  severity: "low" | "medium" | "high" | "critical";
  title: string;
  summary: string;
  postmortem: string | null;
  visible_to_client: boolean;
  detected_via: string | null;
};
