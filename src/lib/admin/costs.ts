import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Cost rollup per workspace_id. Reads token totals from audit_logs and
 * converts to USD using public Anthropic pricing for the model we use.
 *
 * The numbers here are READ-ONLY estimates — Anthropic's invoice is the
 * source of truth. We surface our estimate to (a) flag runaway clients
 * and (b) compute margin per engagement before the bill lands.
 *
 * Claude Haiku 4.5 pricing (2025-2026, USD per 1M tokens):
 *   input:  $1.00
 *   output: $5.00
 *
 * Override the prices via env at deploy time if Anthropic updates pricing
 * mid-contract.
 */

const HAIKU_INPUT_USD_PER_1M = Number(process.env.HAIKU_INPUT_USD_PER_1M ?? "1.00");
const HAIKU_OUTPUT_USD_PER_1M = Number(process.env.HAIKU_OUTPUT_USD_PER_1M ?? "5.00");

export type CostWindow = "24h" | "7d" | "30d" | "all";

const WINDOW_MS: Record<CostWindow, number | null> = {
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
  all: null,
};

export type CostBreakdown = {
  inputTokens: number;
  outputTokens: number;
  estimatedUsd: number;
  conversations: number;
  trendDaily: Array<{ date: string; usd: number }>;
};

/**
 * Aggregate cost for a given workspace_id across a time window. Each
 * audit_logs row carries token_usage_in/out for chat decisions; PII
 * blocks and origin denies count as $0 (no Anthropic call).
 */
export async function getCostBreakdown(
  sb: SupabaseClient,
  workspaceId: string,
  window: CostWindow = "30d",
): Promise<CostBreakdown> {
  const windowMs = WINDOW_MS[window];
  let q = sb
    .from("audit_logs")
    .select("inserted_at, token_usage_in, token_usage_out, user_id")
    .eq("workspace_id", workspaceId);
  if (windowMs !== null) {
    q = q.gte("inserted_at", new Date(Date.now() - windowMs).toISOString());
  }
  const { data, error } = await q.limit(5000);
  if (error || !data) {
    return { inputTokens: 0, outputTokens: 0, estimatedUsd: 0, conversations: 0, trendDaily: [] };
  }

  let inTok = 0;
  let outTok = 0;
  const sessions = new Set<string>();
  const dailyMap = new Map<string, { in: number; out: number }>();

  for (const row of data) {
    const ti = (row.token_usage_in as number | null) ?? 0;
    const to = (row.token_usage_out as number | null) ?? 0;
    inTok += ti;
    outTok += to;
    if (row.user_id) sessions.add(row.user_id as string);

    const day = (row.inserted_at as string).slice(0, 10);
    const existing = dailyMap.get(day) ?? { in: 0, out: 0 };
    existing.in += ti;
    existing.out += to;
    dailyMap.set(day, existing);
  }

  const estimatedUsd = tokensToUsd(inTok, outTok);

  const trendDaily = [...dailyMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, t]) => ({ date, usd: tokensToUsd(t.in, t.out) }));

  return {
    inputTokens: inTok,
    outputTokens: outTok,
    estimatedUsd,
    conversations: sessions.size,
    trendDaily,
  };
}

export function tokensToUsd(inTokens: number, outTokens: number): number {
  return (
    (inTokens / 1_000_000) * HAIKU_INPUT_USD_PER_1M +
    (outTokens / 1_000_000) * HAIKU_OUTPUT_USD_PER_1M
  );
}

export function formatUsdPrecise(usd: number): string {
  if (usd >= 100) return `$${usd.toFixed(0)}`;
  if (usd >= 1) return `$${usd.toFixed(2)}`;
  return `$${usd.toFixed(3)}`;
}
