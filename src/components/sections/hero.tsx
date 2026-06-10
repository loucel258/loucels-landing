"use client";

import { motion } from "framer-motion";
import { ArrowUpRight, Sparkles } from "lucide-react";
import { useEffect, useRef } from "react";
import { Cluster3D } from "@/components/hero/cluster-3d";
import { Magnetic } from "@/components/motion/magnetic";
import { BookViaChatButton } from "@/components/chat/book-via-chat-button";
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

const wordVariants = {
  hidden: { opacity: 0, y: 18, filter: "blur(8px)" },
  visible: { opacity: 1, y: 0, filter: "blur(0px)" },
};

export function Hero({ dict }: { dict: Dictionary }) {
  const sectionRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;
    if (
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      return;
    let raf = 0;
    let tx = 50;
    let ty = 50;
    let cx = 50;
    let cy = 50;
    const onMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      tx = ((e.clientX - r.left) / r.width) * 100;
      ty = ((e.clientY - r.top) / r.height) * 100;
      if (!raf) raf = requestAnimationFrame(tick);
    };
    const tick = () => {
      cx += (tx - cx) * 0.08;
      cy += (ty - cy) * 0.08;
      el.style.setProperty("--cursor-x", `${cx}%`);
      el.style.setProperty("--cursor-y", `${cy}%`);
      if (Math.abs(tx - cx) > 0.1 || Math.abs(ty - cy) > 0.1) {
        raf = requestAnimationFrame(tick);
      } else {
        raf = 0;
      }
    };
    el.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      el.removeEventListener("pointermove", onMove);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <section
      ref={sectionRef}
      id="top"
      className="relative isolate min-h-[100svh] overflow-hidden pt-32 md:pt-36"
      style={
        { "--cursor-x": "50%", "--cursor-y": "50%" } as React.CSSProperties
      }
    >
      {/* Cursor-reactive gradient — eased follow, sits below dot grid */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-[1] opacity-60 mix-blend-screen"
        style={{
          background:
            "radial-gradient(600px circle at var(--cursor-x) var(--cursor-y), color-mix(in oklab, var(--accent-cyan) 22%, transparent), transparent 60%)",
        }}
      />
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
        <Cluster3D imageSrc="/hero/01-cluster.webp" glareIntensity={0.22} />
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

            {/* Massive headline — word-by-word cascade */}
            {(() => {
              // Global word counter so cascade flows across all lines, not
              // resetting per line. Last line's final word is highlighted cyan.
              let wordIdx = 0;
              const baseDelay = 0.35;
              const stepDelay = 0.07;
              return (
                <h1 className="text-editorial-hero max-w-[20ch] text-balance text-text-primary">
                  {dict.hero.titleLines.map((line, lineI) => {
                    const isLastLine =
                      lineI === dict.hero.titleLines.length - 1;
                    const words = line.split(" ");
                    return (
                      <span key={lineI} className="block">
                        {words.map((word, wI) => {
                          const isLastWord =
                            isLastLine && wI === words.length - 1;
                          const myDelay = baseDelay + wordIdx * stepDelay;
                          wordIdx += 1;
                          return (
                            <span
                              key={wI}
                              className="relative inline-block"
                              style={{ marginRight: "0.28em" }}
                            >
                              <motion.span
                                className={`inline-block ${
                                  isLastWord ? "text-cyan" : ""
                                }`}
                                variants={wordVariants}
                                initial="hidden"
                                animate="visible"
                                transition={{
                                  duration: 0.7,
                                  delay: myDelay,
                                  ease: [0.16, 1, 0.3, 1],
                                }}
                              >
                                {word}
                              </motion.span>
                              {isLastWord && (
                                <motion.span
                                  aria-hidden
                                  className="absolute -bottom-1 left-0 h-[3px] w-full bg-cyan"
                                  initial={{ scaleX: 0 }}
                                  animate={{ scaleX: 1 }}
                                  transition={{
                                    duration: 0.7,
                                    delay: myDelay + 0.5,
                                    ease: [0.16, 1, 0.3, 1],
                                  }}
                                  style={{
                                    transformOrigin: "left",
                                    boxShadow: "0 0 12px var(--accent-cyan)",
                                  }}
                                />
                              )}
                            </span>
                          );
                        })}
                      </span>
                    );
                  })}
                </h1>
              );
            })()}

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
              <Magnetic strength={0.3}>
                <BookViaChatButton className="group inline-flex h-13 w-fit items-center gap-3 rounded-xl border border-cyan/40 bg-cyan/10 px-7 py-3.5 text-[14px] font-semibold text-cyan transition-all duration-300 hover:border-cyan hover:bg-cyan hover:text-bg hover:shadow-[0_0_40px_-4px_var(--accent-cyan-glow)]">
                  <span>{dict.hero.primaryCta}</span>
                  <ArrowUpRight
                    className="size-4 transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
                    strokeWidth={2}
                  />
                </BookViaChatButton>
              </Magnetic>
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
              <Cluster3D imageSrc="/hero/01-cluster.webp" glareIntensity={0.20} />
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
