import "server-only";

/**
 * Reject requests larger than `maxBytes` before reading the body. Returns
 * null when within the cap; otherwise a 413 Response the caller should
 * return directly. Avoids buffering attacker-supplied megabytes into a
 * serverless function.
 */
export function rejectIfTooLarge(req: Request, maxBytes: number): Response | null {
  const header = req.headers.get("content-length");
  if (!header) return null;
  const len = Number.parseInt(header, 10);
  if (!Number.isFinite(len)) return null;
  if (len > maxBytes) {
    return new Response("payload too large", { status: 413 });
  }
  return null;
}
