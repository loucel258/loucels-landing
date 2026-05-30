import { z } from "zod";

/**
 * Schema for `audit_logs.redaction_summary`. Today this column is a
 * loose JSONB blob with at least three competing shapes used across
 * routes:
 *
 *   DLP route:  { SSN: 2, CARD_NUMBER: 1, layer2_used: 0, from_regex: 3, ... }
 *   HITL route: { agent_draft_hash, final_text_hash, was_edited, diff_lines }
 *   HITL roll:  { agent_draft_hash, final_text_hash, rollback: 1 }
 *
 * That's fine for grep but terrible for forensic queries — a SOC review
 * looking for "all DLP entries that used Layer 2" has to know each
 * route's idiosyncratic key names. This module defines a single union
 * schema with discriminator `kind` and a normalizer that callers use
 * before passing the blob to `writeAuditEntry`. Legacy callers that
 * skip the normalizer still work (the schema is enforced loosely, not
 * gating the write) but tooling can rely on the discriminator.
 */

// ---------- DLP shape ----------
const DlpSummarySchema = z.object({
  kind: z.literal("dlp"),
  by_type: z.record(z.string(), z.number().int().nonnegative()).default({}),
  layer2_used: z.number().int().min(0).max(1).default(0),
  layer2_available: z.number().int().min(0).max(1).default(0),
  from_regex: z.number().int().nonnegative().default(0),
  from_context: z.number().int().nonnegative().default(0),
  from_llm: z.number().int().nonnegative().default(0),
});

// ---------- HITL decide (terminal) ----------
const HitlDecideSummarySchema = z.object({
  kind: z.literal("hitl_decide"),
  agent_draft_hash: z.string().regex(/^[a-f0-9]{64}$/),
  final_text_hash: z.string().regex(/^[a-f0-9]{64}$/),
  was_edited: z.number().int().min(0).max(1),
  diff_lines: z.number().int().nonnegative(),
});

// ---------- HITL rollback ----------
const HitlRollbackSummarySchema = z.object({
  kind: z.literal("hitl_rollback"),
  agent_draft_hash: z.string().regex(/^[a-f0-9]{64}$/),
  final_text_hash: z.string().regex(/^[a-f0-9]{64}$/),
  rollback: z.literal(1),
});

// ---------- RBAC ----------
const RbacSummarySchema = z.object({
  kind: z.literal("rbac"),
  layer2_used: z.number().int().min(0).max(1).default(0),
  layer2_available: z.number().int().min(0).max(1).default(0),
  llm_technique: z.string().optional(),
  llm_confidence: z.number().min(0).max(1).optional(),
});

export const RedactionSummarySchema = z.discriminatedUnion("kind", [
  DlpSummarySchema,
  HitlDecideSummarySchema,
  HitlRollbackSummarySchema,
  RbacSummarySchema,
]);

export type RedactionSummary = z.infer<typeof RedactionSummarySchema>;

/**
 * Normalize and validate a redaction_summary before writing. Returns
 * the parsed object on success; throws ZodError on shape violation so
 * the bug surfaces during dev rather than rotting in the audit log.
 */
export function normalizeRedactionSummary(
  input: unknown,
): RedactionSummary {
  return RedactionSummarySchema.parse(input);
}
