"use client";

import Image from "next/image";
import { motion } from "framer-motion";
import { ArrowUpRight, Sparkles } from "lucide-react";
import { siteConfig } from "@/lib/site-config";
import type { Dictionary } from "@/i18n/dictionaries/en";

/**
 * Hero — 2-column split: text left (60%) / image right (40%).
 * Headline takes weight on the left, image carries visual impact on the right.
 * Ambient cyan/violet glows in the page corners for atmosphere.
 *
 * Image area is a 4:5 portrait card with corner ticks. Currently a placeholder
 * waiting for Steven's incoming media — once provided, swap the placeholder
 * div for <Image src={...} /> inside the card.
 */

const headlineVariants = {
  hidden: { opacity: 0, y: 28, filter: "blur(12px)" },
  visible: { opacity: 1, y: 0, filter: "blur(0px)" },
};

export function Hero({ dict }: { dict: Dictionary }) {
  return (
    <section
      id="top"
      className="relative isolate min-h-[100svh] overflow-hidden pt-32 md:pt-36"
    >
      {/* Ambient — sutil dot grid */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-dotgrid opacity-[0.18] [mask-image:radial-gradient(ellipse_70%_60%_at_50%_30%,black,transparent)]"
      />
      {/* Cyan glow top-left */}
      <div
        aria-hidden
        className="pointer-events-none absolute -left-32 -top-32 size-[520px] rounded-full opacity-30 blur-[120px]"
        style={{
          background:
            "radial-gradient(circle, color-mix(in oklab, var(--accent-cyan) 65%, transparent), transparent 70%)",
        }}
      />
      {/* Violet glow bottom-right */}
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-32 -right-32 size-[460px] rounded-full opacity-25 blur-[120px]"
        style={{
          background:
            "radial-gradient(circle, color-mix(in oklab, var(--accent-violet) 65%, transparent), transparent 70%)",
        }}
      />

      {/* RIGHT IMAGE — floating, frameless, bleeds behind text (desktop only) */}
      <motion.div
        aria-hidden
        className="pointer-events-none absolute right-0 top-1/2 z-0 hidden h-[110%] w-[62%] -translate-y-1/2 lg:block xl:w-[58%]"
        initial={{ opacity: 0, x: 30 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 1.2, delay: 0.4, ease: [0.16, 1, 0.3, 1] }}
        style={{
          // Radial mask centered on the right — fades all edges, no card boundary
          maskImage:
            "radial-gradient(ellipse 75% 65% at 65% 50%, black 0%, rgba(0,0,0,0.95) 25%, rgba(0,0,0,0.55) 60%, transparent 95%)",
          WebkitMaskImage:
            "radial-gradient(ellipse 75% 65% at 65% 50%, black 0%, rgba(0,0,0,0.95) 25%, rgba(0,0,0,0.55) 60%, transparent 95%)",
        }}
      >
        <Image
          src="/hero/01-cluster.webp"
          alt=""
          fill
          priority
          quality={90}
          sizes="(max-width: 1024px) 100vw, 62vw"
          className="object-cover object-center"
        />
      </motion.div>

      {/* Bottom fade — dissolves image edge into next section */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 z-[1] h-48 bg-gradient-to-b from-transparent via-bg/60 to-bg"
      />

      <div className="container-page relative z-10 pb-16 md:pb-24">
        <div className="flex flex-col gap-12 lg:flex-row lg:items-center lg:gap-16">
          {/* LEFT — Text column (sits OVER the absolute image on desktop) */}
          <div className="flex flex-col gap-8 md:gap-10 lg:w-[55%]">
            {/* Eyebrow pill */}
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.2 }}
            >
              <span className="inline-flex items-center gap-2 rounded-full border border-border-soft bg-surface/60 px-3.5 py-1.5 text-micro text-cyan backdrop-blur-md">
                <Sparkles className="size-3" strokeWidth={1.5} />
                {dict.hero.eyebrow}
              </span>
            </motion.div>

            {/* Massive headline */}
            <motion.h1
              className="text-editorial-hero max-w-[20ch] text-balance text-text-primary"
              initial="hidden"
              animate="visible"
              variants={{
                hidden: {},
                visible: {
                  transition: {
                    staggerChildren: 0.12,
                    delayChildren: 0.35,
                  },
                },
              }}
            >
              {dict.hero.titleLines.map((line, i) => {
                const isLast = i === dict.hero.titleLines.length - 1;
                return (
                  <motion.span
                    key={i}
                    variants={headlineVariants}
                    transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
                    className="block"
                  >
                    {isLast ? (
                      <span>
                        {line.split(" ").slice(0, -1).join(" ")}{" "}
                        <span className="relative inline-block">
                          <span className="text-cyan">
                            {line.split(" ").slice(-1)[0]}
                          </span>
                          <motion.span
                            aria-hidden
                            className="absolute -bottom-1 left-0 h-[3px] w-full bg-cyan"
                            initial={{ scaleX: 0 }}
                            animate={{ scaleX: 1 }}
                            transition={{
                              duration: 0.7,
                              delay: 1.5,
                              ease: [0.16, 1, 0.3, 1],
                            }}
                            style={{
                              transformOrigin: "left",
                              boxShadow: "0 0 12px var(--accent-cyan)",
                            }}
                          />
                        </span>
                      </span>
                    ) : (
                      line
                    )}
                  </motion.span>
                );
              })}
            </motion.h1>

            {/* Subtitle */}
            <motion.p
              className="max-w-xl text-body-lg text-balance text-text-secondary"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                duration: 0.8,
                delay: 1.3,
                ease: [0.16, 1, 0.3, 1],
              }}
            >
              {dict.hero.subtitle}
            </motion.p>

            {/* CTA — single button */}
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                duration: 0.8,
                delay: 1.5,
                ease: [0.16, 1, 0.3, 1],
              }}
            >
              <a
                href={siteConfig.calUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="group inline-flex h-13 w-fit items-center gap-3 rounded-xl border border-cyan/40 bg-cyan/10 px-7 py-3.5 text-[14px] font-semibold text-cyan transition-all duration-300 hover:border-cyan hover:bg-cyan hover:text-bg hover:shadow-[0_0_40px_-4px_var(--accent-cyan-glow)]"
              >
                <span>{dict.hero.primaryCta}</span>
                <ArrowUpRight
                  className="size-4 transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
                  strokeWidth={2}
                />
              </a>
            </motion.div>

            {/* Trust line / meta */}
            <motion.div
              className="flex flex-wrap items-center gap-x-6 gap-y-3 pt-4 text-mono-xs text-text-tertiary"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.8, delay: 1.8 }}
            >
              <span className="inline-flex items-center gap-1.5">
                <span
                  aria-hidden
                  className="relative inline-flex size-1.5"
                >
                  <span className="absolute inset-0 rounded-full bg-cyan-glow" />
                  <span className="absolute inset-0 animate-ping rounded-full bg-cyan-glow opacity-60" />
                </span>
                ANTHROPIC CLAUDE
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span
                  aria-hidden
                  className="size-1.5 rounded-full bg-violet"
                />
                NIST AI RMF · SOC 2 READY
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span
                  aria-hidden
                  className="size-1.5 rounded-full bg-text-tertiary"
                />
                BILINGUAL · EN / ES
              </span>
            </motion.div>
          </div>

          {/* MOBILE-only image — floating, frameless (on lg+, the absolute image above takes over) */}
          <motion.div
            aria-hidden
            className="relative w-full lg:hidden"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 1, delay: 0.5, ease: [0.16, 1, 0.3, 1] }}
          >
            <div
              className="relative aspect-[4/5] w-full"
              style={{
                maskImage:
                  "radial-gradient(ellipse 80% 75% at 50% 50%, black 38%, transparent 92%)",
                WebkitMaskImage:
                  "radial-gradient(ellipse 80% 75% at 50% 50%, black 38%, transparent 92%)",
              }}
            >
              <Image
                src="/hero/01-cluster.webp"
                alt=""
                fill
                priority
                quality={85}
                sizes="100vw"
                className="object-cover"
              />
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
