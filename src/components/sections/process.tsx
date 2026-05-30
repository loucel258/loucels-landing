"use client";

import { motion, useScroll, useTransform } from "framer-motion";
import { useRef } from "react";
import { Reveal } from "@/components/motion/reveal";
import type { Dictionary } from "@/i18n/dictionaries/en";

export function Process({ dict }: { dict: Dictionary }) {
  const ref = useRef<HTMLOListElement>(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start end", "end center"],
  });
  const lineScale = useTransform(scrollYProgress, [0, 0.9], [0, 1]);

  return (
    <section className="relative isolate overflow-hidden py-32 md:py-40">
      {/* Cyan ray — intermittent, diagonal */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-0 overflow-hidden"
      >
        <motion.div
          className="absolute left-[10%] top-[35%] h-[2px] w-[55%] origin-left -rotate-[8deg]"
          style={{
            background:
              "linear-gradient(to right, transparent 0%, var(--accent-cyan) 50%, transparent 100%)",
            boxShadow:
              "0 0 24px var(--accent-cyan-glow), 0 0 8px var(--accent-cyan)",
          }}
          animate={{ opacity: [0, 0.75, 0], scaleX: [0.8, 1, 0.8] }}
          transition={{
            duration: 5,
            repeat: Infinity,
            ease: "easeInOut",
          }}
        />
      </div>

      <div className="container-page relative z-10 flex flex-col gap-16">
        <Reveal className="flex flex-col gap-6">
          <span className="text-micro text-cyan">// {dict.process.eyebrow}</span>
          <h2 className="text-display-2 max-w-3xl text-balance text-text-primary">
            {dict.process.title}
          </h2>
        </Reveal>

        <ol
          ref={ref}
          className="relative grid gap-12 md:grid-cols-2 lg:grid-cols-4 lg:gap-6"
        >
          <motion.div
            aria-hidden
            className="absolute left-5 right-5 top-5 hidden h-px origin-left bg-gradient-to-r from-cyan via-violet to-cyan lg:block"
            style={{
              scaleX: lineScale,
              boxShadow: "0 0 12px var(--accent-cyan)",
            }}
          />
          {dict.process.steps.map((step, idx) => (
            <ProcessStep
              key={idx}
              step={step}
              idx={idx}
              progress={scrollYProgress}
              total={dict.process.steps.length}
            />
          ))}
        </ol>
      </div>
    </section>
  );
}

function ProcessStep({
  step,
  idx,
  progress,
  total,
}: {
  step: { n: string; title: string; desc: string };
  idx: number;
  progress: ReturnType<typeof useScroll>["scrollYProgress"];
  total: number;
}) {
  const start = idx / total;
  const end = (idx + 1) / total;
  const opacity = useTransform(progress, [start, end], [0.35, 1]);
  const scale = useTransform(progress, [start, end], [0.96, 1]);

  return (
    <motion.li
      style={{ opacity, scale }}
      className="relative flex flex-col gap-4"
    >
      <span className="relative z-10 flex size-10 items-center justify-center rounded-full border border-border-soft bg-surface text-mono-xs text-text-primary">
        {step.n}
      </span>
      <h3 className="text-h4 text-text-primary">{step.title}</h3>
      <p className="text-body-sm text-pretty text-text-secondary">
        {step.desc}
      </p>
    </motion.li>
  );
}
