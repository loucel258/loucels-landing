import "server-only";
import { getServiceClient } from "@/lib/audit/client";

// Small cache so route handlers don't round-trip on every request. A
// role-add by an admin propagates within TTL_MS; that's fine for a
// table that changes when humans onboard, not per request.
const TTL_MS = 60_000;
const cache = new Map<string, { value: boolean; expiresAt: number }>();

/**
 * Validate a JWT's `role_label` claim against the workspace_roles table
 * (migration 017). Returns true only if the table has a matching row
 * for (workspace_id, role_label).
 *
 * When Supabase is not configured we return TRUE — the demo runs
 * without persistence and we can't gate on data that doesn't exist.
 * Production should always have Supabase wired up.
 */
export async function isWorkspaceRoleValid(
  workspace_id: string,
  role_label: string,
): Promise<boolean> {
  const key = `${workspace_id}|${role_label}`;
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const client = getServiceClient();
  if (!client) {
    // Demo-mode escape hatch. Production has the service client wired.
    cache.set(key, { value: true, expiresAt: Date.now() + TTL_MS });
    return true;
  }

  const { data, error } = await client.rpc("workspace_role_exists", {
    p_workspace_id: workspace_id,
    p_role_label: role_label,
  });
  if (error) {
    console.error("isWorkspaceRoleValid: RPC failed", {
      workspace_id,
      role_label,
      error,
    });
    // Fail-open on transient DB error rather than locking the tenant
    // out of their own auth. Logged so ops can investigate.
    cache.set(key, { value: true, expiresAt: Date.now() + 5_000 });
    return true;
  }

  const value = Boolean(data);
  cache.set(key, { value, expiresAt: Date.now() + TTL_MS });
  return value;
}
