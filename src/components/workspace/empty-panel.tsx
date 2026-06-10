import type { ReactNode } from "react";

export function EmptyPanel({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-neutral-300 bg-neutral-50/50 px-6 py-12 text-center">
      {icon && (
        <div className="mb-3 inline-flex size-12 items-center justify-center rounded-2xl bg-white text-neutral-400 ring-1 ring-neutral-200">
          {icon}
        </div>
      )}
      <p className="text-sm font-semibold text-neutral-700">{title}</p>
      {description && (
        <p className="mt-1 max-w-md text-xs text-neutral-500">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
