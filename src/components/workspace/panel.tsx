import type { ReactNode } from "react";

/**
 * Panel — the standard card surface used inside Workspace tabs and the
 * Client Portal. Provides a header row (icon + title + optional eyebrow
 * + actions slot) and a body that pads content uniformly.
 */
export function Panel({
  title,
  eyebrow,
  icon,
  actions,
  tone = "default",
  children,
  bodyClassName,
}: {
  title?: string;
  eyebrow?: string;
  icon?: ReactNode;
  actions?: ReactNode;
  tone?: "default" | "muted" | "danger" | "success" | "accent";
  children: ReactNode;
  bodyClassName?: string;
}) {
  const toneCls = {
    default: "border-neutral-200 bg-white",
    muted: "border-neutral-200 bg-neutral-50",
    danger: "border-rose-200 bg-rose-50/40",
    success: "border-emerald-200 bg-emerald-50/40",
    accent: "border-cyan-200 bg-cyan-50/40",
  }[tone];

  return (
    <section className={`rounded-2xl border ${toneCls} shadow-sm`}>
      {(title || actions) && (
        <header className="flex items-start justify-between gap-3 border-b border-neutral-200/70 px-5 py-3.5">
          <div className="min-w-0">
            {eyebrow && (
              <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-neutral-500">
                {eyebrow}
              </p>
            )}
            {title && (
              <h3 className="flex items-center gap-2 text-sm font-semibold text-neutral-900">
                {icon && (
                  <span className="inline-flex size-5 items-center justify-center text-neutral-500">
                    {icon}
                  </span>
                )}
                <span>{title}</span>
              </h3>
            )}
          </div>
          {actions && <div className="shrink-0">{actions}</div>}
        </header>
      )}
      <div className={bodyClassName ?? "p-5"}>{children}</div>
    </section>
  );
}

export function PanelGrid({
  cols = 2,
  children,
}: {
  cols?: 1 | 2 | 3;
  children: ReactNode;
}) {
  const colCls = cols === 1 ? "" : cols === 2 ? "lg:grid-cols-2" : "lg:grid-cols-3";
  return <div className={`grid grid-cols-1 gap-5 ${colCls}`}>{children}</div>;
}
