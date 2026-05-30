import { ROLES, type Role, type Scope, type Action } from "./roles";
import { classify, type Classification } from "./classifier";

export type PolicyCheck = {
  name: string;
  passed: boolean;
  detail: string;
  /** Which detection layer made the call. "regex" = Layer 1 keyword.
   *  "llm" = Layer 2 Claude classifier. "policy" = scope/action lookup. */
  source?: "regex" | "llm" | "policy";
};

export type PolicyDecision = {
  query: string;
  role: Role;
  classification: Classification;
  checks: PolicyCheck[];
  decision: "ALLOW" | "DENY";
  reason: string;
  blockedBy: PolicyCheck | null;
  /** Whether Layer 2 was attempted on this decision. */
  layer2Used: boolean;
  /** Whether Layer 2 returned a verdict. False if env missing or call failed. */
  layer2Available: boolean;
  /** Raw classifier verdict if Layer 2 ran. Useful for the UI to show
   *  technique + confidence + reason. */
  llmInjectionVerdict?: {
    is_injection: boolean;
    technique: string;
    confidence: number;
    reason: string;
  };
};

/**
 * Run the full policy chain for a (role, query) pair.
 *
 * Order of checks (short-circuits on first failure):
 *   1. Prompt-injection guardrail (always enforced, regardless of role)
 *   2. Forbidden scopes for this role
 *   3. Forbidden actions for this role
 *   4. Scope/action must be within role's allowed list (positive auth)
 *
 * Returning the full chain — not just the final decision — is the whole
 * point. A CTO wants to see WHY a request was blocked and which guardrail
 * fired, not a binary yes/no.
 */
export function evaluate(role: Role, query: string): PolicyDecision {
  const classification = classify(query);
  const profile = ROLES[role];
  const checks: PolicyCheck[] = [];

  // 1. Prompt injection guardrail (Layer 1 keyword regex)
  const injection = classification.promptInjection;
  checks.push({
    name: "Prompt Injection Guardrail (Layer 1)",
    passed: !injection.detected,
    detail: injection.detected
      ? `Matched injection patterns: ${injection.matched.map((m) => `"${m}"`).join(", ")}`
      : "No injection patterns detected by regex.",
    source: "regex",
  });

  // 2. Forbidden scopes
  const hitForbiddenScope = classification.scopes.find((s) =>
    profile.forbiddenScopes.includes(s as Scope),
  );
  checks.push({
    name: `Forbidden Scopes for ${profile.label}`,
    passed: !hitForbiddenScope,
    detail: hitForbiddenScope
      ? `Query touches forbidden scope: ${hitForbiddenScope}`
      : `No forbidden scopes touched. Role denies: ${profile.forbiddenScopes.join(", ")}.`,
    source: "policy",
  });

  // 3. Forbidden actions
  const hitForbiddenAction = classification.actions.find((a) =>
    profile.forbiddenActions.includes(a as Action),
  );
  checks.push({
    name: `Forbidden Actions for ${profile.label}`,
    passed: !hitForbiddenAction,
    detail: hitForbiddenAction
      ? `Query requests forbidden action: ${hitForbiddenAction}`
      : `No forbidden actions requested. Role denies: ${profile.forbiddenActions.join(", ")}.`,
    source: "policy",
  });

  // 4. Positive scope authorization (every requested scope must be allowed)
  const unauthorizedScope = classification.scopes.find(
    (s) => !profile.allowedScopes.includes(s as Scope),
  );
  checks.push({
    name: "Scope Authorization",
    passed: !unauthorizedScope,
    detail: unauthorizedScope
      ? `Scope "${unauthorizedScope}" is not in this role's allowed list.`
      : classification.scopes.length === 0
        ? "Query did not match a recognized scope (treated as generic, allowed)."
        : `All requested scopes are within role allow list.`,
    source: "policy",
  });

  const blockedBy = checks.find((c) => !c.passed) ?? null;
  return {
    query,
    role,
    classification,
    checks,
    decision: blockedBy ? "DENY" : "ALLOW",
    reason: blockedBy
      ? blockedBy.detail
      : "All policy checks passed. Request is authorized.",
    blockedBy,
    layer2Used: false,
    layer2Available: false,
  };
}

// Layer 2 LLM evaluation lives in `policy-llm.ts` (server-only) so client
// bundles that import `evaluate` for preview don't pull the Anthropic SDK.
