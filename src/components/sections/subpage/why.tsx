"use client";

import { Reveal, StaggerGroup, StaggerItem } from "@/components/motion/reveal";
import type { Dictionary } from "@/i18n/dictionaries/en";
import { SectionRay } from "./section-ray";

export function SubpageWhy({
  data,
}: {
  data: Dictionary["webFoundation"]["why"];
}) {
  return (
    <section className="relative isolate overflow-hidden py-24 md:py-32">
      <SectionRay color="cyan" direction="lr" delay={1.2} />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-border-soft to-transparent"
      />
      <div className="container-page relative z-10">
        <div className="grid grid-cols-1 gap-12 lg:grid-cols-[0.9fr_1.4fr] lg:gap-20">
          <Reveal className="flex flex-col gap-5">
            <span className="text-micro text-violet">// {data.eyebrow}</span>
            <h2 className="text-display-2 text-balance text-text-primary">
              {data.title}
            </h2>
          </Reveal>

          <StaggerGroup className="flex flex-col divide-y divide-border-soft">
            {data.items.map((item) => (
              <StaggerItem key={item.title}>
                <article className="flex flex-col gap-3 py-6 first:pt-0 md:flex-row md:items-start md:gap-10">
                  <h3 className="text-h4 shrink-0 text-text-primary md:w-[220px]">
                    {item.title}
                  </h3>
                  <p className="flex-1 text-body text-pretty text-text-secondary">
                    {item.desc}
                  </p>
                </article>
              </StaggerItem>
            ))}
          </StaggerGroup>
        </div>
      </div>
    </section>
  );
}
