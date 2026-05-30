"use client";

import { Reveal, StaggerGroup, StaggerItem } from "@/components/motion/reveal";
import type { Dictionary } from "@/i18n/dictionaries/en";
import { SectionRay } from "./section-ray";

export function SubpageProblem({
  data,
}: {
  data: Dictionary["webFoundation"]["problem"];
}) {
  return (
    <section id="problem" className="relative isolate overflow-hidden py-24 md:py-32">
      <SectionRay color="violet" direction="rl" delay={0.3} />
      {/* Violet ambient — subtle warning hue */}
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
              <article className="grid grid-cols-[auto_1fr] items-start gap-x-8 gap-y-3 py-10 md:grid-cols-[180px_1fr] md:gap-x-16 md:py-14">
                <span
                  aria-hidden
                  className="text-[64px] font-light leading-none tabular-nums text-violet md:text-[88px]"
                  style={{ fontFeatureSettings: "'ss01'" }}
                >
                  {item.n}
                </span>
                <div className="flex flex-col gap-4 pt-2 md:pt-4">
                  <h3 className="text-h3 text-balance text-text-primary">
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
