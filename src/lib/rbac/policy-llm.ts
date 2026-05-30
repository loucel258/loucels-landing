import "server-only";
import { evaluate, type PolicyCheck, type PolicyDecision } from "./policy";
import type { Role } from "./roles";
import { classifyInjectionWithLLM } from "./injection-classifier-llm";
import { Layer2RequiredError } from "@/lib/clients/policy";

/**
 * Server-only async evaluation that adds a Layer 2 Claude classifier check
 * for prompt injection on top of the synchronous `evaluate()`.
 *
 * Lives in a separate file from policy.ts so that client bundles (e.g.
 * /demo/rbac UI) can import the sync `evaluate` for preview rendering
 * without pulling the Anthropic SDK and `server-only` into the client.
 *
 * Behavior:
 *   - If Layer 1 already blocked, no LLM call (save tokens).
 *   - Otherwise call Claude Haiku, insert verdict as check #2.
 *   - On any LLM failure: silently fall back to Layer 1 with
 *     `layer2Available: false`. The chain never gets WORSE because of LLM
 *     failure.
 */
export async function evaluateWithLLM(
  role: Role,
  query: string,
  opts: { failClosed?: boolean; workspace_id?: string } = {},
): Promise<PolicyDecision> {
  const base = evaluate(role, query);

  const layer1Blocked = base.checks[0].passed === false;
  if (layer1Blocked) {
    return { ...base, layer2Used: false, layer2Available: false };
  }

  const llm = await classifyInjectionWithLLM(query);

  if (!llm.available || !llm.verdict) {
    if (opts.failClosed) {
      throw new Layer2RequiredError(
        opts.workspace_id ?? "unknown",
        "injection classifier returned no verdict",
      );
    }
    return { ...base, layer2Used: true, layer2Available: false };
  }

  const layer2Check: PolicyCheck = {
    name: "Prompt Injection Classifier (Layer 2)",
    passed: !llm.verdict.is_injection,
    detail: llm.verdict.is_injection
      ? `Layer 2 flagged: ${llm.verdict.technique} (confidence ${llm.verdict.confidence}). ${llm.verdict.reason}`
      : `Layer 2 cleared: ${llm.verdict.reason} (confidence ${llm.verdict.confidence}).`,
    source: "llm",
  };

  const checks = [base.checks[0], layer2Check, ...base.checks.slice(1)];
  const blockedBy = checks.find((c) => !c.passed) ?? null;

  return {
    ...base,
    checks,
    decision: blockedBy ? "DENY" : "ALLOW",
    reason: blockedBy
      ? blockedBy.detail
      : "All policy checks passed (Layer 1 + Layer 2). Request is authorized.",
    blockedBy,
    layer2Used: true,
    layer2Available: true,
    llmInjectionVerdict: llm.verdict,
  };
}
