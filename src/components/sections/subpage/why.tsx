"use client";

import { Reveal, StaggerGroup, StaggerItem } from "@/components/motion/reveal";
import { TiltCard } from "@/components/motion/tilt-card";
import type { Dictionary } from "@/i18n/dictionaries/en";
import { SectionRay } from "./section-ray";

/**
 * SubpageWhy — card grid (was a flat divided list, felt too bare).
 *
 * Each differentiator now lives in its own card with:
 *  - tabular number index (cyan)
 *  - title + body
 *  - TiltCard wrapper for subtle 3D following the cursor
 *  - hover ring + lift
 *
 * Grid adapts: 1 col → 2 col at md → keeps it tight even with 3 items.
 */

export function SubpageWhy({
  data,
  accent = "cyan",
}: {
  data: Dictionary["webFoundation"]["why"];
  accent?: "cyan" | "violet";
}) {
  const isViolet = accent === "violet";
  const eyebrowClass = isViolet ? "text-violet" : "text-cyan";
  const indexClass = isViolet ? "text-violet" : "text-cyan";
  const accentVar = isViolet ? "var(--accent-violet)" : "var(--accent-cyan)";
  const hoverBorder = isViolet ? "hover:border-violet/40" : "hover:border-cyan/40";
  const lineGradient = isViolet
    ? "bg-gradient-to-r from-violet/40 to-transparent"
    : "bg-gradient-to-r from-cyan/40 to-transparent";

  return (
    <section className="relative isolate overflow-hidden py-24 md:py-32">
      <SectionRay color="cyan" direction="lr" delay={1.2} />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-border-soft to-transparent"
      />

      <div className="container-page relative z-10">
        <Reveal className="flex max-w-2xl flex-col gap-5">
          <span className={`text-micro ${eyebrowClass}`}>// {data.eyebrow}</span>
          <h2 className="text-display-2 text-balance text-text-primary">
            {data.title}
          </h2>
        </Reveal>

        <StaggerGroup className="mt-14 grid grid-cols-1 gap-5 md:mt-16 md:grid-cols-2 md:gap-6">
          {data.items.map((item, i) => {
            // If item count is odd and this is the last item, span both columns
            // and constrain to half-width centered — visually anchors a 3-card
            // layout instead of leaving the last card floating on the left.
            const isOddLast =
              data.items.length % 2 !== 0 && i === data.items.length - 1;
            return (
            <StaggerItem
              key={item.title}
              className={
                isOddLast
                  ? "md:col-span-2 md:mx-auto md:w-[calc(50%-12px)]"
                  : undefined
              }
            >
              <TiltCard maxTilt={6} glare={false} className="h-full">
                <article
                  className={`group relative flex h-full flex-col gap-4 rounded-2xl border border-border-soft bg-surface/60 p-7 backdrop-blur-sm transition-all duration-500 hover:bg-surface-2 md:p-8 ${hoverBorder}`}
                  style={{ transitionTimingFunction: "cubic-bezier(0.16, 1, 0.3, 1)" }}
                >
                  <span
                    aria-hidden
                    className="pointer-events-none absolute -inset-px rounded-2xl opacity-0 transition-opacity duration-500 group-hover:opacity-100"
                    style={{
                      boxShadow: `0 0 0 1px ${accentVar}, 0 0 40px -4px color-mix(in oklab, ${accentVar} 45%, transparent), 0 8px 32px -8px color-mix(in oklab, ${accentVar} 25%, transparent)`,
                    }}
                  />
                  <div className="flex items-center gap-3">
                    <span className={`text-mono-xs tabular-nums ${indexClass}`}>
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span
                      aria-hidden
                      className={`h-px flex-1 ${lineGradient}`}
                    />
                  </div>
                  <h3 className="text-h4 text-balance text-text-primary">
                    {item.title}
                  </h3>
                  <p className="text-body-sm text-pretty text-text-secondary">
                    {item.desc}
                  </p>
                </article>
              </TiltCard>
            </StaggerItem>
            );
          })}
        </StaggerGroup>
      </div>
    </section>
  );
}
