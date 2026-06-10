import "server-only";
import { getServiceClient } from "@/lib/audit/client";

/**
 * Per-tenant monthly token budget (migration 042). The chat route calls
 * `isBudgetExhausted` before invoking Claude and `recordUsage` after each
 * turn. Both fail open on infrastructure errors — a Supabase blip should
 * degrade to "no enforcement this turn", not take the agent down — but
 * the audit chain still records every turn's usage, so drift is visible.
 */

export async function isBudgetExhausted(
  workspaceId: string,
  monthlyBudget: number,
): Promise<boolean> {
  // Budget 0 or negative = unlimited (deliberate escape hatch for
  // internal agents).
  if (monthlyBudget <= 0) return false;
  const sb = getServiceClient();
  if (!sb) return false;
  try {
    const month = new Date();
    const monthKey = `${month.getUTCFullYear()}-${String(month.getUTCMonth() + 1).padStart(2, "0")}-01`;
    const { data } = await sb
      .from("agent_usage_monthly")
      .select("tokens_in, tokens_out")
      .eq("workspace_id", workspaceId)
      .eq("month", monthKey)
      .maybeSingle();
    if (!data) return false;
    const row = data as { tokens_in: number; tokens_out: number };
    return row.tokens_in + row.tokens_out >= monthlyBudget;
  } catch {
    return false;
  }
}

export async function recordUsage(
  workspaceId: string,
  tokensIn: number,
  tokensOut: number,
): Promise<void> {
  if (tokensIn <= 0 && tokensOut <= 0) return;
  const sb = getServiceClient();
  if (!sb) return;
  try {
    await sb.rpc("increment_agent_usage", {
      p_workspace_id: workspaceId,
      p_tokens_in: tokensIn,
      p_tokens_out: tokensOut,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[budget] usage increment failed:", err);
  }
}
