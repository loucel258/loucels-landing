/**
 * RBAC role catalog for the Trust Stack RBAC demo.
 *
 * Two roles modeled after a real mid-market deployment:
 *  - `front_desk_agent`: a junior customer-facing operator. Can handle leads,
 *    quotes, and appointments. CANNOT touch HR, finance, system prompts, or
 *    bulk-export customer data.
 *  - `compliance_officer`: read-only auditor with broad visibility across
 *    operational data but explicitly NOT allowed to send customer-facing
 *    responses or modify records (separation of duties).
 *
 * In production these scopes map 1:1 to Supabase RLS policies. In the demo
 * we enforce them in-memory so the architecture pattern is visible without
 * requiring a live database.
 */

export type Role = "front_desk_agent" | "compliance_officer";

export type Scope =
  | "customer_contact"
  | "lead_status"
  | "appointment"
  | "quote"
  | "hr_data"
  | "finance_internal"
  | "system_admin"
  | "customer_pii_export"
  | "audit_log"
  | "policy_review";

export type Action =
  | "read"
  | "create"
  | "update_own"
  | "delete"
  | "export_bulk"
  | "modify_pricing"
  | "send_customer_message"
  | "audit"
  | "report";

export type RoleProfile = {
  id: Role;
  label: string;
  description: string;
  allowedScopes: Scope[];
  forbiddenScopes: Scope[];
  allowedActions: Action[];
  forbiddenActions: Action[];
};

export const ROLES: Record<Role, RoleProfile> = {
  front_desk_agent: {
    id: "front_desk_agent",
    label: "Front Desk Agent (Junior)",
    description:
      "Handles inbound leads, qualifies prospects, schedules appointments, drafts quotes.",
    allowedScopes: ["customer_contact", "lead_status", "appointment", "quote"],
    forbiddenScopes: [
      "hr_data",
      "finance_internal",
      "system_admin",
      "customer_pii_export",
    ],
    allowedActions: ["read", "create", "update_own", "send_customer_message"],
    forbiddenActions: ["delete", "export_bulk", "modify_pricing", "audit"],
  },
  compliance_officer: {
    id: "compliance_officer",
    label: "Compliance Officer (Senior)",
    description:
      "Read-only auditor with broad operational visibility. Reviews logs and policies. Cannot act on customers.",
    allowedScopes: [
      "customer_contact",
      "lead_status",
      "appointment",
      "quote",
      "audit_log",
      "policy_review",
      "finance_internal",
    ],
    forbiddenScopes: [
      "hr_data",
      "system_admin",
      "customer_pii_export",
    ],
    allowedActions: ["read", "audit", "report"],
    forbiddenActions: [
      "create",
      "update_own",
      "delete",
      "export_bulk",
      "modify_pricing",
      "send_customer_message",
    ],
  },
};
