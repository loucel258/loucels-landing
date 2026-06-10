/**
 * Display formatters for admin dashboard.
 * Cents-based money to avoid float math surprises across the codebase.
 */

export function formatUsdFromCents(cents: number | null | undefined): string {
  if (cents == null) return "—";
  const dollars = cents / 100;
  if (dollars >= 1_000_000) {
    return `$${(dollars / 1_000_000).toFixed(2)}M`;
  }
  if (dollars >= 10_000) {
    return `$${Math.round(dollars).toLocaleString()}`;
  }
  return `$${dollars.toLocaleString(undefined, {
    minimumFractionDigits: dollars % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatUsdInt(dollars: number | null | undefined): string {
  if (dollars == null) return "—";
  if (dollars >= 1_000_000) {
    return `$${(dollars / 1_000_000).toFixed(2)}M`;
  }
  return `$${Math.round(dollars).toLocaleString()}`;
}

export function formatPct(value: number | null | undefined, digits = 0): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value.toFixed(digits)}%`;
}

export function formatShortDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
  });
}

export function daysAgo(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / 86400000);
}
