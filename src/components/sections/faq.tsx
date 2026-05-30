"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Plus } from "lucide-react";
import { Reveal, StaggerGroup, StaggerItem } from "@/components/motion/reveal";
import { FAQSchema } from "@/components/structured-data";
import type { Dictionary } from "@/i18n/dictionaries/en";

/**
 * FAQ — neutralizes the 6 most common mid-market objections before the final CTA.
 * Single-open accordion with smooth height animation. No side-stripe borders.
 * Active item gets a full violet border + subtle violet inner glow.
 */
export function FAQ({ dict }: { dict: Dictionary }) {
  const [openIndex, setOpenIndex] = useState<number | null>(0);
  const data = dict.faq;

  return (
    <section
      id="faq"
      className="relative isolate overflow-hidden py-24 md:py-32"
    >
      <FAQSchema items={data.items} />
      {/* Ambient violet — subtle warning/curiosity hue */}
      <div
        aria-hidden
        className="pointer-events-none absolute -left-32 bottom-1/3 size-[420px] rounded-full opacity-20 blur-[140px]"
        style={{
          background:
            "radial-gradient(circle, color-mix(in oklab, var(--accent-violet) 55%, transparent), transparent 70%)",
        }}
      />
      {/* Cyan ray intermittent — same pattern as other sections */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-0 overflow-hidden"
      >
        <motion.div
          className="absolute right-[8%] bottom-[30%] h-[2px] w-[55%] origin-right -rotate-[8deg]"
          style={{
            background:
              "linear-gradient(to left, transparent 0%, var(--accent-cyan) 50%, transparent 100%)",
            boxShadow:
              "0 0 24px var(--accent-cyan-glow), 0 0 8px var(--accent-cyan)",
          }}
          animate={{ opacity: [0, 0.7, 0], scaleX: [0.8, 1, 0.8] }}
          transition={{
            duration: 7,
            delay: 1.5,
            repeat: Infinity,
            ease: "easeInOut",
          }}
        />
      </div>

      <div className="container-page relative z-10">
        <div className="grid grid-cols-1 gap-12 lg:grid-cols-[0.9fr_1.5fr] lg:gap-20">
          {/* LEFT — eyebrow + title (sticky on desktop) */}
          <Reveal className="flex flex-col gap-5 lg:sticky lg:top-32 lg:self-start">
            <span className="text-micro text-violet">// {data.eyebrow}</span>
            <h2 className="text-display-2 text-balance text-text-primary">
              {data.title}
            </h2>
          </Reveal>

          {/* RIGHT — accordion */}
          <StaggerGroup className="flex flex-col gap-3">
            {data.items.map((item, i) => {
              const isOpen = openIndex === i;
              return (
                <StaggerItem key={item.q}>
                  <article
                    className={`group relative overflow-hidden rounded-xl border bg-surface/70 backdrop-blur-sm transition-colors duration-300 ${
                      isOpen
                        ? "border-violet/50 bg-surface-2"
                        : "border-border-soft hover:border-border-default"
                    }`}
                  >
                    {isOpen && (
                      <span
                        aria-hidden
                        className="pointer-events-none absolute -inset-px rounded-xl"
                        style={{
                          boxShadow:
                            "0 0 24px -8px color-mix(in oklab, var(--accent-violet) 45%, transparent)",
                        }}
                      />
                    )}
                    <button
                      type="button"
                      onClick={() => setOpenIndex(isOpen ? null : i)}
                      aria-expanded={isOpen}
                      className="relative flex w-full items-center justify-between gap-6 px-6 py-5 text-left transition-colors md:px-7 md:py-6"
                    >
                      <span className="flex items-baseline gap-4">
                        <span className="text-mono-xs tabular-nums text-text-tertiary">
                          {String(i + 1).padStart(2, "0")}
                        </span>
                        <span className="text-[16px] font-semibold leading-tight text-text-primary md:text-[17px]">
                          {item.q}
                        </span>
                      </span>
                      <motion.span
                        aria-hidden
                        animate={{ rotate: isOpen ? 45 : 0 }}
                        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
                        className={`flex size-7 shrink-0 items-center justify-center rounded-full border transition-colors ${
                          isOpen
                            ? "border-violet/60 text-violet"
                            : "border-border-soft text-text-tertiary group-hover:border-cyan/40 group-hover:text-cyan"
                        }`}
                      >
                        <Plus className="size-3.5" strokeWidth={2} />
                      </motion.span>
                    </button>

                    <AnimatePresence initial={false}>
                      {isOpen && (
                        <motion.div
                          key="answer"
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{
                            height: { duration: 0.45, ease: [0.16, 1, 0.3, 1] },
                            opacity: { duration: 0.3, delay: isOpen ? 0.1 : 0 },
                          }}
                          className="overflow-hidden"
                        >
                          <div className="pl-[60px] pr-6 pb-6 md:pl-[68px] md:pr-7 md:pb-7">
                            <p className="text-body text-pretty text-text-secondary">
                              {item.a}
                            </p>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </article>
                </StaggerItem>
              );
            })}
          </StaggerGroup>
        </div>
      </div>
    </section>
  );
}
