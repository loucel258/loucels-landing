import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { mintWorkspaceJwt } from "./jwt";

/**
 * Returns a Supabase client whose every request is scoped to a single
 * workspace via a freshly-minted, short-lived JWT. All RLS policies that
 * use `current_workspace_id()` will see this workspace_id.
 *
 * This is the ONLY supported runtime client for tenant-bound queries. Code
 * that uses the unscoped `service_role` client must include an explicit
 * `.eq('workspace_id', X)` filter — and that path should be reserved for
 * admin / cross-tenant operations only.
 */
export async function getWorkspaceClient(
  workspace_id: string,
  options?: { role_label?: string; ttlSeconds?: number },
): Promise<SupabaseClient> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error("Supabase env vars missing");
  }
  const jwt = await mintWorkspaceJwt({
    workspace_id,
    role_label: options?.role_label,
    ttlSeconds: options?.ttlSeconds,
  });
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
}
