"use client";

import { Reveal, StaggerGroup, StaggerItem } from "@/components/motion/reveal";
import type { Dictionary } from "@/i18n/dictionaries/en";
import { SectionRay } from "./section-ray";

/**
 * SubpageProblem — agitation section. Each problem now has:
 *  - Hover affordance (border + bg shift on hover) to invite engagement
 *  - Soft violet glow that ignites on hover behind the giant number
 *  - Subtle bg color on hover to add depth (was static text-only)
 *
 * Items remain in a vertical stack divided by lines — that visual rhythm is
 * intentional for "list of bad things." We just gave each item life.
 */

export function SubpageProblem({
  data,
}: {
  data: Dictionary["webFoundation"]["problem"];
}) {
  return (
    <section id="problem" className="relative isolate overflow-hidden py-24 md:py-32">
      <SectionRay color="violet" direction="rl" delay={0.3} />
      <div
        aria-hidden
        className="pointer-events-none absolute right-0 top-1/3 size-[400px] rounded-full opacity-20 blur-[140px]"
        style={{
          background:
            "radial-gradient(circle, color-mix(in oklab, var(--accent-violet) 55%, transparent), transparent 70%)",
        }}
      />

      <div className="container-page relative z-10">
        <Reveal className="flex max-w-2xl flex-col gap-5">
          <span className="text-micro text-violet">// {data.eyebrow}</span>
          <h2 className="text-display-2 text-balance text-text-primary">
            {data.title}
          </h2>
        </Reveal>

        <StaggerGroup className="mt-16 flex flex-col divide-y divide-border-soft">
          {data.items.map((item) => (
            <StaggerItem key={item.n}>
              <article className="group relative grid grid-cols-[auto_1fr] items-start gap-x-8 gap-y-3 py-10 transition-colors duration-500 md:grid-cols-[180px_1fr] md:gap-x-16 md:py-14">
                {/* Soft violet glow behind the number — ignites on hover */}
                <span
                  aria-hidden
                  className="pointer-events-none absolute left-0 top-1/2 size-32 -translate-y-1/2 rounded-full opacity-0 blur-[60px] transition-opacity duration-500 group-hover:opacity-60 md:size-44"
                  style={{
                    background:
                      "radial-gradient(circle, color-mix(in oklab, var(--accent-violet) 70%, transparent), transparent 70%)",
                  }}
                />
                <span
                  aria-hidden
                  className="relative z-10 text-[64px] font-light leading-none tabular-nums text-violet transition-all duration-500 group-hover:[text-shadow:0_0_28px_color-mix(in_oklab,var(--accent-violet)_60%,transparent)] md:text-[88px]"
                  style={{ fontFeatureSettings: "'ss01'" }}
                >
                  {item.n}
                </span>
                <div className="relative z-10 flex flex-col gap-4 pt-2 md:pt-4">
                  <h3 className="text-h3 text-balance text-text-primary transition-colors duration-500 group-hover:text-violet">
                    {item.title}
                  </h3>
                  <p className="max-w-2xl text-body text-pretty text-text-secondary">
                    {item.desc}
                  </p>
                </div>
              </article>
            </StaggerItem>
          ))}
        </StaggerGroup>
      </div>
    </section>
  );
}
