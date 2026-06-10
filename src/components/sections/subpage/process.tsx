"use client";

import {
  motion,
  useMotionValueEvent,
  useScroll,
  useTransform,
} from "framer-motion";
import { Check } from "lucide-react";
import { useRef, useState } from "react";
import { Reveal, StaggerGroup, StaggerItem } from "@/components/motion/reveal";
import type { Dictionary } from "@/i18n/dictionaries/en";
import { SectionRay } from "./section-ray";

/**
 * SubpageProcess — scroll-linked step ignition (idle → active → done).
 *
 * Mirrors the home Process treatment: as the visitor scrolls, each circle
 * ignites in sequence. Active step gets a pulsing halo, completed steps
 * collapse to a checkmark. The horizontal/vertical timeline line stays as
 * structural guide; the ignition is what makes it feel alive.
 */

export function SubpageProcess({
  data,
  accent = "cyan",
}: {
  data: Dictionary["webFoundation"]["process"];
  accent?: "cyan" | "violet";
}) {
  const isViolet = accent === "violet";
  const eyebrowClass = isViolet ? "text-violet" : "text-cyan";
  const circleColor = isViolet ? "var(--accent-violet)" : "var(--accent-cyan)";
  const lineGradient = isViolet
    ? "from-violet/0 via-violet/30 to-violet/0 md:bg-gradient-to-r"
    : "from-cyan/0 via-cyan/30 to-cyan/0 md:bg-gradient-to-r";
  const hoverGlowVar = isViolet ? "var(--accent-cyan)" : "var(--accent-violet)";

  const ref = useRef<HTMLOListElement>(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start end", "end center"],
  });

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
            <ol ref={ref} className="contents">
              {data.steps.map((step, idx) => (
                <StaggerItem key={step.n}>
                  <ProcessStep
                    step={step}
                    idx={idx}
                    total={data.steps.length}
                    progress={scrollYProgress}
                    accent={accent}
                    circleColor={circleColor}
                    hoverGlowVar={hoverGlowVar}
                  />
                </StaggerItem>
              ))}
            </ol>
          </StaggerGroup>
        </div>
      </div>
    </section>
  );
}

function ProcessStep({
  step,
  idx,
  total,
  progress,
  accent,
  circleColor,
  hoverGlowVar,
}: {
  step: { n: string; title: string; desc: string };
  idx: number;
  total: number;
  progress: ReturnType<typeof useScroll>["scrollYProgress"];
  accent: "cyan" | "violet";
  circleColor: string;
  hoverGlowVar: string;
}) {
  const start = idx / total;
  const end = (idx + 1) / total;
  const opacity = useTransform(progress, [start, end], [0.4, 1]);
  const scale = useTransform(progress, [start, end], [0.97, 1]);

  const [state, setState] = useState<"idle" | "active" | "done">("idle");
  useMotionValueEvent(progress, "change", (p) => {
    if (p >= end - 0.02) setState("done");
    else if (p >= start) setState("active");
    else setState("idle");
  });

  const isViolet = accent === "violet";
  const circleCls =
    state === "done"
      ? isViolet
        ? "border-violet bg-violet text-bg"
        : "border-cyan bg-cyan text-bg"
      : state === "active"
        ? isViolet
          ? "border-violet/70 text-violet"
          : "border-cyan/70 text-cyan"
        : isViolet
          ? "border-violet/40 text-violet"
          : "border-cyan/40 text-cyan";

  return (
    <motion.li
      style={{ opacity, scale }}
      className="group relative flex flex-col gap-5 pl-14 md:pl-0 md:pt-14"
    >
      {/* Floating hover glow — complementary color */}
      <span
        aria-hidden
        className="pointer-events-none absolute left-0 top-0 size-9 -translate-x-1/2 -translate-y-1/2 rounded-full opacity-0 blur-[40px] transition-opacity duration-500 group-hover:opacity-100 md:left-1/2 md:top-[18px] md:size-16"
        style={{
          background: `radial-gradient(circle, color-mix(in oklab, ${hoverGlowVar} 80%, transparent), transparent 70%)`,
          transform: "translate(-50%, -50%) scale(3.5)",
        }}
      />
      {/* Circle — ignites with scroll */}
      <motion.span
        animate={{ scale: state === "active" ? 1.08 : 1 }}
        transition={{ type: "spring", stiffness: 380, damping: 22 }}
        className={`absolute left-0 top-0 z-10 flex size-9 items-center justify-center rounded-full border bg-bg text-mono-xs tabular-nums transition-colors duration-500 md:left-1/2 md:-translate-x-1/2 ${circleCls}`}
        style={{
          boxShadow:
            state === "done"
              ? `0 0 0 4px var(--bg), 0 0 28px -2px ${circleColor}`
              : state === "active"
                ? `0 0 0 4px var(--bg), 0 0 22px -2px color-mix(in oklab, ${circleColor} 80%, transparent)`
                : `0 0 0 4px var(--bg), 0 0 12px -2px color-mix(in oklab, ${circleColor} 40%, transparent)`,
        }}
      >
        {state === "done" ? (
          <Check className="size-4" strokeWidth={2.5} />
        ) : (
          step.n
        )}
        {state === "active" && (
          <motion.span
            aria-hidden
            className="absolute inset-0 rounded-full border"
            style={{ borderColor: circleColor }}
            initial={{ scale: 1, opacity: 0.7 }}
            animate={{ scale: 2, opacity: 0 }}
            transition={{ duration: 1.4, repeat: Infinity, ease: "easeOut" }}
          />
        )}
      </motion.span>
      <h3 className="text-h3 text-balance text-text-primary md:text-center">
        {step.title}
      </h3>
      <p className="text-body text-pretty text-text-secondary md:text-center">
        {step.desc}
      </p>
    </motion.li>
  );
}
