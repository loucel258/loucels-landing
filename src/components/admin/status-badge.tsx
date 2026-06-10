/**
 * StatusBadge — semantic status pill.
 *
 * Maps engagement / agent / lead status strings to consistent visual tokens
 * so the same status looks identical everywhere it appears in the admin.
 */

const STATUS_MAP: Record<
  string,
  { label: string; cls: string }
> = {
  // Engagement statuses
  prospect_signed_up: {
    label: "SOW sent",
    cls: "bg-neutral-100 text-neutral-700 ring-1 ring-neutral-300",
  },
  sow_signed: {
    label: "SOW signed",
    cls: "bg-cyan-50 text-cyan-700 ring-1 ring-cyan-200",
  },
  paid: {
    label: "Paid",
    cls: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
  },
  intake_received: {
    label: "Intake received",
    cls: "bg-cyan-50 text-cyan-700 ring-1 ring-cyan-200",
  },
  kickoff_scheduled: {
    label: "Kickoff scheduled",
    cls: "bg-violet-50 text-violet-700 ring-1 ring-violet-200",
  },
  in_progress: {
    label: "In progress",
    cls: "bg-violet-50 text-violet-700 ring-1 ring-violet-200",
  },
  delivered: {
    label: "Delivered",
    cls: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
  },
  converted_to_build: {
    label: "Converted",
    cls: "bg-emerald-100 text-emerald-800 ring-1 ring-emerald-300",
  },
  declined: {
    label: "Declined",
    cls: "bg-neutral-100 text-neutral-600 ring-1 ring-neutral-300",
  },
  abandoned: {
    label: "Abandoned",
    cls: "bg-neutral-100 text-neutral-500 ring-1 ring-neutral-300",
  },
  sow_voided: {
    label: "SOW voided",
    cls: "bg-rose-50 text-rose-700 ring-1 ring-rose-200",
  },
  payment_failed: {
    label: "Payment failed",
    cls: "bg-rose-50 text-rose-700 ring-1 ring-rose-200",
  },
  // Lead statuses
  offered: {
    label: "Offered",
    cls: "bg-neutral-100 text-neutral-700 ring-1 ring-neutral-300",
  },
  confirmed: {
    label: "Confirmed",
    cls: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
  },
  rescheduled: {
    label: "Rescheduled",
    cls: "bg-amber-50 text-amber-700 ring-1 ring-amber-200",
  },
  cancelled: {
    label: "Cancelled",
    cls: "bg-rose-50 text-rose-700 ring-1 ring-rose-200",
  },
  // Agent statuses
  designing: {
    label: "Designing",
    cls: "bg-neutral-100 text-neutral-700 ring-1 ring-neutral-300",
  },
  shadow_mode: {
    label: "Shadow mode",
    cls: "bg-violet-50 text-violet-700 ring-1 ring-violet-200",
  },
  uat: {
    label: "UAT",
    cls: "bg-amber-50 text-amber-700 ring-1 ring-amber-200",
  },
  live: {
    label: "Live",
    cls: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
  },
  paused: {
    label: "Paused",
    cls: "bg-amber-50 text-amber-700 ring-1 ring-amber-200",
  },
  archived: {
    label: "Archived",
    cls: "bg-neutral-100 text-neutral-500 ring-1 ring-neutral-300",
  },
};

export function StatusBadge({ status }: { status: string }) {
  const entry = STATUS_MAP[status] ?? {
    label: status,
    cls: "bg-neutral-100 text-neutral-700 ring-1 ring-neutral-300",
  };
  return (
    <span
      className={`inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${entry.cls}`}
    >
      {entry.label}
    </span>
  );
}
