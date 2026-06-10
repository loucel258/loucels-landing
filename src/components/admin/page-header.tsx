import type { ReactNode } from "react";

/**
 * PageHeader — admin page chrome (title + breadcrumb + actions).
 */
export function PageHeader({
  title,
  subtitle,
  breadcrumb,
  actions,
}: {
  title: string;
  subtitle?: string;
  breadcrumb?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-6">
      {breadcrumb && (
        <div className="mb-1 text-[11px] uppercase tracking-wider text-neutral-500">
          {breadcrumb}
        </div>
      )}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-neutral-900">
            {title}
          </h1>
          {subtitle && (
            <p className="mt-1 text-sm text-neutral-600">{subtitle}</p>
          )}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}
