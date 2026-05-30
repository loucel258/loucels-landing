"use client";

import Image from "next/image";
import { motion, useScroll, useTransform } from "framer-motion";
import { useRef } from "react";
import { ArrowUpRight } from "lucide-react";
import { siteConfig } from "@/lib/site-config";
import type { Dictionary } from "@/i18n/dictionaries/en";

export function SubpageHero({
  data,
  imageSrc,
  accent = "cyan",
  secondaryGlow,
  trustStrip,
}: {
  data: Dictionary["webFoundation"]["hero"];
  imageSrc: string;
  accent?: "cyan" | "violet";
  secondaryGlow?: "cyan" | "violet";
  trustStrip?: string;
}) {
  const isViolet = accent === "violet";
  const primaryGlowVar = isViolet ? "var(--accent-violet)" : "var(--accent-cyan)";
  const eyebrowClass = isViolet ? "text-violet" : "text-cyan";
  const secondaryGlowVar =
    secondaryGlow === "violet"
      ? "var(--accent-violet)"
      : secondaryGlow === "cyan"
        ? "var(--accent-cyan)"
        : null;
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start start", "end start"],
  });
  // Subtle scroll-driven parallax: image drifts, scales slightly, holds opacity longer
  const imageY = useTransform(scrollYProgress, [0, 1], [0, 140]);
  const imageScale = useTransform(scrollYProgress, [0, 1], [1, 1.06]);
  const imageOpacity = useTransform(scrollYProgress, [0, 0.7, 1], [1, 0.95, 0.6]);

  return (
    <section
      ref={ref}
      className="relative isolate overflow-hidden py-20 md:py-28"
    >
      {/* Primary ambient glow, top-left */}
      <div
        aria-hidden
        className="pointer-events-none absolute -left-40 -top-20 size-[480px] rounded-full opacity-25 blur-[120px]"
        style={{
          background: `radial-gradient(circle, color-mix(in oklab, ${primaryGlowVar} 60%, transparent), transparent 70%)`,
        }}
      />
      {/* Secondary companion glow, bottom-right (optional, per page) */}
      {secondaryGlowVar && (
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-32 -right-32 size-[420px] rounded-full opacity-20 blur-[140px]"
          style={{
            background: `radial-gradient(circle, color-mix(in oklab, ${secondaryGlowVar} 55%, transparent), transparent 70%)`,
          }}
        />
      )}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-dotgrid opacity-[0.12] [mask-image:radial-gradient(ellipse_60%_50%_at_30%_40%,black,transparent)]"
      />

      {/* Floating frameless image — right side, mask radial */}
      <motion.div
        aria-hidden
        className="pointer-events-none absolute right-0 top-1/2 z-0 hidden h-[110%] w-[58%] -translate-y-1/2 lg:block xl:w-[54%]"
        style={{
          y: imageY,
          scale: imageScale,
          opacity: imageOpacity,
          maskImage:
            "radial-gradient(ellipse 75% 65% at 65% 50%, black 0%, rgba(0,0,0,0.95) 25%, rgba(0,0,0,0.55) 60%, transparent 95%)",
          WebkitMaskImage:
            "radial-gradient(ellipse 75% 65% at 65% 50%, black 0%, rgba(0,0,0,0.95) 25%, rgba(0,0,0,0.55) 60%, transparent 95%)",
        }}
        initial={{ opacity: 0, x: 30 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 1.2, delay: 0.4, ease: [0.16, 1, 0.3, 1] }}
      >
        <Image
          src={imageSrc}
          alt=""
          fill
          priority
          quality={90}
          sizes="(max-width: 1024px) 100vw, 58vw"
          className="object-cover object-center"
        />
      </motion.div>

      {/* Bottom fade — dissolves image edge into next section */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 z-[1] h-48 bg-gradient-to-b from-transparent via-bg/60 to-bg"
      />

      <div className="container-page relative z-10">
        <div className="flex max-w-2xl flex-col gap-7 lg:max-w-[55%]">
          <motion.span
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.1 }}
            className={`text-micro ${eyebrowClass}`}
          >
            // {data.eyebrow}
          </motion.span>

          <motion.h1
            className="text-editorial-hero max-w-[20ch] text-balance text-text-primary"
            initial={{ opacity: 0, y: 28, filter: "blur(12px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            transition={{ duration: 0.9, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
          >
            {data.title}
          </motion.h1>

          <motion.p
            className="text-body-lg max-w-xl text-balance text-text-secondary"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.5 }}
          >
            {data.subtitle}
          </motion.p>

          <motion.div
            className="flex flex-wrap items-center gap-5 pt-2"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.7 }}
          >
            <motion.a
              href={siteConfig.calUrl}
              target="_blank"
              rel="noopener noreferrer"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              transition={{ type: "spring", stiffness: 400, damping: 25 }}
              className="group inline-flex h-12 items-center gap-3 rounded-xl border border-cyan/40 bg-cyan/10 px-6 py-3 text-[14px] font-semibold text-cyan transition-colors duration-300 hover:border-cyan hover:bg-cyan hover:text-bg hover:shadow-[0_0_40px_-4px_var(--accent-cyan-glow)]"
            >
              <span>{data.primaryCta}</span>
              <ArrowUpRight
                className="size-4 transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
                strokeWidth={2}
              />
            </motion.a>
            <a
              href="#problem"
              className="text-mono-xs text-text-tertiary underline-offset-4 transition-colors hover:text-cyan hover:underline"
            >
              {data.secondaryCta.toUpperCase()}
            </a>
          </motion.div>

          {trustStrip && (
            <motion.div
              className="flex items-center gap-3 pt-2 text-mono-xs text-text-tertiary"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.8, delay: 0.95 }}
            >
              <span
                aria-hidden
                className="block h-px w-10 bg-violet"
                style={{ boxShadow: "0 0 6px var(--accent-violet)" }}
              />
              <span className="max-w-xl text-pretty">{trustStrip}</span>
            </motion.div>
          )}
        </div>

        {/* Mobile-only floating image */}
        <motion.div
          aria-hidden
          className="relative mt-12 w-full lg:hidden"
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
              src={imageSrc}
              alt=""
              fill
              quality={85}
              sizes="100vw"
              className="object-cover"
            />
          </div>
        </motion.div>
      </div>
    </section>
  );
}
