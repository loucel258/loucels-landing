/**
 * Segment-level loading boundary for the whole portal. Every portal page
 * is force-dynamic with several Supabase queries plus transcript
 * decryption, so navigation without this felt frozen: the old page just
 * sat there. The skeleton mirrors the common page shape (hero surface,
 * metric row, two panels) so the swap to real content is low-shift.
 */
export default function PortalLoading() {
  return (
    <div className="animate-pulse space-y-7" aria-busy="true" aria-live="polite">
      {/* Hero surface */}
      <div className="h-44 rounded-3xl border border-neutral-200 bg-gradient-to-br from-neutral-100 via-white to-neutral-100" />

      {/* Metric row */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="h-24 rounded-2xl border border-neutral-200 bg-neutral-100" />
        <div className="h-24 rounded-2xl border border-neutral-200 bg-neutral-100" />
        <div className="h-24 rounded-2xl border border-neutral-200 bg-neutral-100" />
      </div>

      {/* Content panels */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="h-64 rounded-2xl border border-neutral-200 bg-neutral-100" />
        <div className="h-64 rounded-2xl border border-neutral-200 bg-neutral-100" />
      </div>

      <span className="sr-only">Loading…</span>
    </div>
  );
}
