import "server-only";
import { headers } from "next/headers";

/**
 * Read the current request pathname server-side. Next 16's middleware
 * sets x-pathname when configured, but to keep this app's middleware
 * focused on locale routing only, we accept either x-pathname (if set
 * later) or fall back to x-invoke-path (Next internal) — and finally
 * reconstruct from x-url when nothing else is available.
 */
export async function getPathname(fallback: string): Promise<string> {
  const h = await headers();
  return (
    h.get("x-pathname") ??
    h.get("x-invoke-path") ??
    h.get("next-url") ??
    fallback
  );
}
