"use client";

import { Reveal, StaggerGroup, StaggerItem } from "@/components/motion/reveal";
import { TiltCard } from "@/components/motion/tilt-card";
import type { Dictionary } from "@/i18n/dictionaries/en";

/**
 * Why Us — centered layout, no image. Header + 4-card grid.
 * The 4 differentiators get the full visual focus.
 */

export function WhyUs({ dict }: { dict: Dictionary }) {
  return (
    <section className="relative isolate py-32 md:py-40">
      <div className="container-page relative z-10 flex flex-col gap-16">
        <Reveal className="flex flex-col items-center gap-5 text-center">
          <div className="flex items-center gap-3">
            <span aria-hidden className="size-1 rounded-full bg-cyan" />
            <span className="text-micro text-cyan">
              // {dict.why.eyebrow}
            </span>
          </div>
          <h2 className="text-display-2 max-w-3xl text-balance text-text-primary">
            {dict.why.title}
          </h2>
        </Reveal>

        <StaggerGroup className="grid gap-5 md:grid-cols-2 lg:grid-cols-4" stagger={0.12}>
          {dict.why.items.map((item, idx) => (
            <StaggerItem key={idx} preset="slideInRight">
              <TiltCard maxTilt={7} glare className="h-full">
              <article
                className="group relative flex h-full flex-col gap-4 rounded-2xl border border-border-soft bg-surface p-7 transition-all duration-300 hover:border-violet hover:bg-surface-2"
                style={{ transitionTimingFunction: "cubic-bezier(0.16, 1, 0.3, 1)" }}
              >
                {/* Violet glow ring on hover */}
                <span
                  aria-hidden
                  className="pointer-events-none absolute -inset-px rounded-2xl opacity-0 transition-opacity duration-300 group-hover:opacity-100"
                  style={{
                    boxShadow:
                      "0 0 0 1px var(--accent-violet), 0 0 40px -4px color-mix(in oklab, var(--accent-violet) 50%, transparent), 0 8px 32px -8px color-mix(in oklab, var(--accent-violet) 30%, transparent)",
                  }}
                />
                <span className="text-mono-xs tabular-nums text-cyan">
                  {String(idx + 1).padStart(2, "0")}
                </span>
                <h3 className="text-h4 text-text-primary">{item.title}</h3>
                <p className="text-body-sm text-pretty text-text-secondary">
                  {item.desc}
                </p>
              </article>
              </TiltCard>
            </StaggerItem>
          ))}
        </StaggerGroup>
      </div>
    </section>
  );
}
