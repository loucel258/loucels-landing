import "server-only";
import { getServiceClient } from "@/lib/audit/client";
import { writeAuditEntry } from "@/lib/audit/writer";

/**
 * Credential vault wrapper.
 *
 * - Writes always go through service_role and call vault_write_credential
 *   (which encrypts in the database with pgsodium AEAD bound to workspace_id).
 * - Reads always go through vault_read_credential, which enforces JWT
 *   workspace match before decrypting.
 * - Every successful read is logged to audit_logs (source='dlp' for now;
 *   future: dedicated 'vault_read' source). This is non-negotiable — token
 *   usage MUST be traceable.
 */

export type Provider =
  | "twilio"
  | "hubspot"
  | "quickbooks"
  | "google_business"
  | "sendgrid"
  | "stripe"
  | "servicetitan"
  | "microsoft_graph"
  | "gmail";

export type WriteInput = {
  workspace_id: string;
  provider: Provider;
  access_token?: string | null;
  refresh_token?: string | null;
  webhook_secret?: string | null;
  account_identifier?: string | null;
  scopes?: string[];
  expires_at?: Date | null;
};

export type ReadResult = {
  provider: Provider;
  access_token: string | null;
  refresh_token: string | null;
  webhook_secret: string | null;
  account_identifier: string | null;
  scopes: string[];
  expires_at: string | null;
};

export async function writeCredential(
  input: WriteInput,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const client = getServiceClient();
  if (!client) return { ok: false, error: "Supabase not configured" };

  const { data, error } = await client.rpc("vault_write_credential", {
    p_workspace_id: input.workspace_id,
    p_provider: input.provider,
    p_access_token: input.access_token ?? null,
    p_refresh_token: input.refresh_token ?? null,
    p_webhook_secret: input.webhook_secret ?? null,
    p_account_identifier: input.account_identifier ?? null,
    p_scopes: input.scopes ?? [],
    p_expires_at: input.expires_at ? input.expires_at.toISOString() : null,
  });

  if (error || !data) {
    return { ok: false, error: error?.message ?? "vault_write_credential failed" };
  }
  return { ok: true, id: data as string };
}

export async function readCredential(input: {
  workspace_id: string;
  provider: Provider;
  /** Why this token is being read — written to the audit log. */
  reason: string;
  /** Who is acting on behalf of the workspace (agent id, system process). */
  actor: string;
}): Promise<{ ok: true; credential: ReadResult } | { ok: false; error: string }> {
  const client = getServiceClient();
  if (!client) return { ok: false, error: "Supabase not configured" };

  const { data, error } = await client.rpc("vault_read_credential", {
    p_workspace_id: input.workspace_id,
    p_provider: input.provider,
  });

  if (error) return { ok: false, error: error.message };
  if (!data || (data as ReadResult[]).length === 0) {
    return {
      ok: false,
      error: `No credential found for workspace=${input.workspace_id} provider=${input.provider}`,
    };
  }
  const credential = (data as ReadResult[])[0];

  // Forensic record of the read. We DO NOT log the token, only that it was
  // retrieved and by which actor for which purpose. The audit chain captures
  // this as a normal ALLOW with a vault-read reason.
  await writeAuditEntry({
    request_id: `vault_${crypto.randomUUID().slice(0, 8)}`,
    workspace_id: input.workspace_id,
    user_id: input.actor,
    role: "system",
    ip_address: null,
    source: "vault",
    decision: "ALLOW",
    blocked_by: null,
    reason: `vault_read provider=${input.provider} purpose="${input.reason}"`,
    sanitized_prompt_hash: "",
    plain_prompt_for_hash: `vault_read:${input.workspace_id}:${input.provider}`,
    redaction_summary: { vault_read: 1 },
  });

  return { ok: true, credential };
}
