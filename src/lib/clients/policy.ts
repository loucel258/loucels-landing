import "server-only";
import { getServiceClient } from "@/lib/audit/client";

// Tiny in-memory cache so we don't hit Supabase on every DLP call. A
// regulated tenant flipping `layer2_required` should take effect within
// the TTL, which is fine for a policy that changes hours/days apart.
const TTL_MS = 60_000;
const cache = new Map<string, { value: boolean; expiresAt: number }>();

/**
 * Returns the per-workspace "Layer 2 required" flag. When true the
 * caller MUST refuse the request (HTTP 503) if the Layer 2 LLM is
 * unavailable, rather than degrading to Layer 1.
 *
 * Unknown workspaces and Supabase outages both return `false` — this is
 * the safe default for the marketing demo. Production tenants get the
 * strict policy by setting `clients.layer2_required = true`.
 */
export async function getLayer2Required(workspace_id: string): Promise<boolean> {
  const cached = cache.get(workspace_id);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const client = getServiceClient();
  if (!client) {
    cache.set(workspace_id, { value: false, expiresAt: Date.now() + TTL_MS });
    return false;
  }

  const { data, error } = await client.rpc("client_layer2_required", {
    p_workspace_id: workspace_id,
  });

  if (error) {
    console.error("getLayer2Required: RPC failed", { workspace_id, error });
    cache.set(workspace_id, { value: false, expiresAt: Date.now() + TTL_MS });
    return false;
  }

  const value = Boolean(data);
  cache.set(workspace_id, { value, expiresAt: Date.now() + TTL_MS });
  return value;
}

/**
 * Error thrown when Layer 2 was contractually required and the LLM
 * classifier was unavailable. Route handlers translate this to HTTP 503.
 */
export class Layer2RequiredError extends Error {
  readonly code = "LAYER2_REQUIRED_UNAVAILABLE";
  constructor(public readonly workspace_id: string, public readonly detail?: string) {
    super(
      `Layer 2 classifier required for workspace ${workspace_id} but unavailable${
        detail ? `: ${detail}` : ""
      }`,
    );
  }
}
