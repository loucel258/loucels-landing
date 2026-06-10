export type AuditSource = "dlp" | "rbac" | "hitl" | "vault" | "chat" | "webhook" | "portal" | "agent";

export type AuditDecision = "ALLOW" | "DENY";

export type AuditEntry = {
  request_id: string;
  workspace_id: string;
  user_id: string;
  role: string;
  ip_address: string | null;
  source: AuditSource;
  decision: AuditDecision;
  blocked_by: string | null;
  reason: string;
  /**
   * Pre-computed SHA-256 of the sanitized prompt. Caller may leave it as ""
   * and provide `plain_prompt_for_hash` instead — the writer will compute
   * the SHA-256 itself. Either path yields the same value.
   */
  sanitized_prompt_hash: string;
  /**
   * Convenience input: when set, the writer computes SHA-256 of this string
   * and stores it as `sanitized_prompt_hash`. The plaintext itself is NEVER
   * persisted.
   */
  plain_prompt_for_hash?: string;
  detected_scopes?: string[];
  detected_actions?: string[];
  prompt_injection_match_count?: number;
  redaction_count?: number;
  /**
   * Free-form metadata stored as JSONB. Used for redaction-by-type counts,
   * hashes, and other forensic fields the audit log may need to keep
   * alongside the standard columns.
   */
  /**
   * Free-form JSONB. Prefer building via `normalizeRedactionSummary`
   * which enforces a discriminated-union shape per `kind`. The type is
   * intentionally loose because the column is JSONB and legacy entries
   * exist; the Zod schema is the runtime contract.
   */
  redaction_summary?: Record<string, unknown>;
  model_version?: string | null;
  token_usage_in?: number | null;
  token_usage_out?: number | null;
};

export type AuditEntryRow = AuditEntry & {
  id: string;
  inserted_at: string;
  user_id_masked?: string;
  /** Per-workspace monotonic counter; populated by write_audit_entry RPC. */
  workspace_sequence?: number | null;
  /** SHA-256 chain hash; each row is hash(prev_row.prev_row_hash || canonical(this row)). */
  prev_row_hash?: string | null;
};
