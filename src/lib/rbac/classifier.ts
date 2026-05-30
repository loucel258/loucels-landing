import type { Action, Scope } from "./roles";

/**
 * Maps a natural-language query to the scopes + actions it would touch,
 * plus flags any prompt-injection patterns. Deterministic keyword matching —
 * in production this could be replaced with a Claude classifier call, but the
 * pattern (classify → enforce) is identical.
 */

export type Classification = {
  scopes: Scope[];
  actions: Action[];
  promptInjection: { detected: boolean; matched: string[] };
};

const SCOPE_PATTERNS: Array<{ scope: Scope; rx: RegExp }> = [
  { scope: "hr_data", rx: /\b(salar(?:y|ies)|payroll|employee compensation|wage|w-?2|hr file)\b/i },
  {
    scope: "finance_internal",
    rx: /\b(p&?l|profit and loss|cash ?flow|burn rate|gross margin|runway|internal financial|board deck)\b/i,
  },
  {
    scope: "customer_pii_export",
    rx: /\b(export|dump|download|extract)\b[\s\S]{0,40}?\b(all|every|bulk|customers?|contacts?|leads?)\b/i,
  },
  {
    scope: "system_admin",
    rx: /\b(system prompt|root access|admin override|disable (?:guardrail|policy|audit))\b/i,
  },
  { scope: "audit_log", rx: /\b(audit log|access log|activity log|forensic|trail)\b/i },
  { scope: "policy_review", rx: /\b(polic(?:y|ies)|sla|governance review|compliance check)\b/i },
  { scope: "quote", rx: /\b(quote|estimate|cotizaci[óo]n|proposal price)\b/i },
  { scope: "appointment", rx: /\b(appointment|book a call|schedule|meeting|reservation)\b/i },
  { scope: "lead_status", rx: /\b(lead status|pipeline|stage|opportunity status)\b/i },
  {
    scope: "customer_contact",
    rx: /\b(customer|client|contacto|order status|tracking|delivery|reply to)\b/i,
  },
];

const ACTION_PATTERNS: Array<{ action: Action; rx: RegExp }> = [
  { action: "delete", rx: /\b(delete|remove|wipe|drop)\b/i },
  { action: "export_bulk", rx: /\b(export|dump|download|csv)\b[\s\S]{0,40}?\b(all|every|bulk)\b/i },
  { action: "modify_pricing", rx: /\b(change|update|modify|override)\b[\s\S]{0,20}?\bpric(?:e|ing)\b/i },
  {
    action: "send_customer_message",
    rx: /\b(send|email|text|sms|whatsapp|reply)\b[\s\S]{0,30}?\b(customer|client|to her|to him)\b/i,
  },
  { action: "audit", rx: /\b(audit|review for compliance|check controls)\b/i },
  { action: "report", rx: /\b(report|summarize|breakdown|generate.*report)\b/i },
  { action: "create", rx: /\b(create|generate|draft|new\s+quote|new\s+appointment)\b/i },
  { action: "update_own", rx: /\b(update|edit|adjust)\b[\s\S]{0,30}?\b(my|own|this)\b/i },
  { action: "read", rx: /\b(show|list|what is|summarize|get)\b/i },
];

const PROMPT_INJECTION_PATTERNS: RegExp[] = [
  /\bignore (?:all )?previous (?:instructions|prompts|rules)\b/i,
  /\bdisregard (?:the )?(?:above|prior|previous|earlier)\b/i,
  /\byou are now\b/i,
  /\bact as (?:a|an|the|my)\b/i,
  /\bpretend (?:to be|you are)\b/i,
  /\bdeveloper mode\b/i,
  /\boverride your (?:instructions|guardrails|policy|system)\b/i,
  /<\/?system>/i,
  /<\/?instructions>/i,
  /\breveal (?:your )?(?:system )?(?:prompt|instructions)\b/i,
  /\bjailbreak\b/i,
];

export function classify(query: string): Classification {
  const scopes = new Set<Scope>();
  const actions = new Set<Action>();

  for (const { scope, rx } of SCOPE_PATTERNS) {
    if (rx.test(query)) scopes.add(scope);
  }
  for (const { action, rx } of ACTION_PATTERNS) {
    if (rx.test(query)) actions.add(action);
  }

  const matched: string[] = [];
  for (const rx of PROMPT_INJECTION_PATTERNS) {
    const m = query.match(rx);
    if (m) matched.push(m[0]);
  }

  return {
    scopes: [...scopes],
    actions: [...actions],
    promptInjection: { detected: matched.length > 0, matched },
  };
}
