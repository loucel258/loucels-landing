"use client";

import { Reveal, StaggerGroup, StaggerItem } from "@/components/motion/reveal";
import type { Dictionary } from "@/i18n/dictionaries/en";
import { SectionRay } from "./section-ray";

export function SubpageProcess({
  data,
  accent = "cyan",
}: {
  data: Dictionary["webFoundation"]["process"];
  accent?: "cyan" | "violet";
}) {
  const isViolet = accent === "violet";
  // Eyebrow follows section accent; circles + hover invert for contrast
  const eyebrowClass = isViolet ? "text-violet" : "text-cyan";
  const circleColor = isViolet ? "var(--accent-violet)" : "var(--accent-cyan)";
  const circleClass = isViolet
    ? "border-violet/40 text-violet"
    : "border-cyan/40 text-cyan";
  const lineGradient = isViolet
    ? "from-violet/0 via-violet/30 to-violet/0 md:bg-gradient-to-r"
    : "from-cyan/0 via-cyan/30 to-cyan/0 md:bg-gradient-to-r";
  // Hover floating glow flips: cyan section → violet glow; violet section → cyan glow
  const hoverGlowVar = isViolet ? "var(--accent-cyan)" : "var(--accent-violet)";
  return (
    <section className="relative isolate overflow-hidden py-24 md:py-32">
      <SectionRay color="violet" direction="rl" delay={0.9} />
      <div className="container-page relative z-10">
        <Reveal className="flex max-w-2xl flex-col gap-5">
          <span className={`text-micro ${eyebrowClass}`}>// {data.eyebrow}</span>
          <h2 className="text-display-2 text-balance text-text-primary">
            {data.title}
          </h2>
        </Reveal>

        <div className="relative mt-16">
          <div
            aria-hidden
            className={`pointer-events-none absolute left-[18px] top-0 hidden h-full w-px bg-gradient-to-b ${lineGradient} md:left-0 md:right-0 md:top-[18px] md:h-px md:w-full`}
            style={{ boxShadow: `0 0 12px ${circleColor}` }}
          />

          <StaggerGroup className="grid grid-cols-1 gap-12 md:grid-cols-3 md:gap-10">
            {data.steps.map((step) => (
              <StaggerItem key={step.n}>
                <article className="group relative flex flex-col gap-5 pl-14 md:pl-0 md:pt-14">
                  {/* Floating hover glow — complementary color, no outline */}
                  <span
                    aria-hidden
                    className="pointer-events-none absolute left-0 top-0 size-9 -translate-x-1/2 -translate-y-1/2 rounded-full opacity-0 blur-[40px] transition-opacity duration-500 group-hover:opacity-100 md:left-1/2 md:top-[18px] md:size-16"
                    style={{
                      background: `radial-gradient(circle, color-mix(in oklab, ${hoverGlowVar} 80%, transparent), transparent 70%)`,
                      transform: "translate(-50%, -50%) scale(3.5)",
                    }}
                  />
                  <span
                    aria-hidden
                    className={`absolute left-0 top-0 z-10 flex size-9 items-center justify-center rounded-full border bg-bg text-mono-xs tabular-nums md:left-1/2 md:-translate-x-1/2 ${circleClass}`}
                    style={{
                      boxShadow: `0 0 0 4px var(--bg), 0 0 20px -2px color-mix(in oklab, ${circleColor} 60%, transparent)`,
                    }}
                  >
                    {step.n}
                  </span>
                  <h3 className="text-h3 text-balance text-text-primary md:text-center">
                    {step.title}
                  </h3>
                  <p className="text-body text-pretty text-text-secondary md:text-center">
                    {step.desc}
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
