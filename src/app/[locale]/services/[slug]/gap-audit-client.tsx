"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { CountUp } from "@/components/motion/count-up";

/* ────────────────────────────────────────────────────────────
 * Interactive pieces for the Operations Gap Audit page only.
 * Server composition + copy live in gap-audit-sections.tsx.
 * ──────────────────────────────────────────────────────────── */

export type Lens = {
  id: string;
  index: string; // "01"
  accent: string; // CSS color
  name: string;
  question: string;
  examine: string[];
  evidence: string;
  finding: string; // sample finding, report-excerpt style
};

const EASE = [0.22, 1, 0.36, 1] as const;

/**
 * LensExplorer — the audit's moat (3 lenses no SMB competitor runs)
 * as a tabbed instrument panel. Auto-advances until the visitor
 * touches it; from then on it's theirs.
 */
export function LensExplorer({
  lenses,
  evidenceLabel,
  findingLabel,
}: {
  lenses: Lens[];
  evidenceLabel: string;
  findingLabel: string;
}) {
  const [active, setActive] = useState(0);
  const [engaged, setEngaged] = useState(false);
  const reduce = useReducedMotion();
  const containerRef = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    const obs = new IntersectionObserver(
      ([e]) => setInView(!!e?.isIntersecting),
      { threshold: 0.3 },
    );
    obs.observe(node);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    if (engaged || reduce || !inView) return;
    const t = setInterval(() => {
      setActive((a) => (a + 1) % lenses.length);
    }, 5200);
    return () => clearInterval(t);
  }, [engaged, reduce, inView, lenses.length]);

  const lens = lenses[active]!;

  return (
    <div
      ref={containerRef}
      className="grid gap-6 md:grid-cols-[0.42fr_1fr] md:gap-10"
    >
      {/* Tab rail */}
      <div role="tablist" aria-label="Audit lenses" className="flex flex-col">
        {lenses.map((l, i) => {
          const selected = i === active;
          return (
            <button
              key={l.id}
              role="tab"
              aria-selected={selected}
              onClick={() => {
                setEngaged(true);
                setActive(i);
              }}
              className="group relative flex items-baseline gap-4 border-b border-border/50 py-5 text-left transition-colors last:border-b-0"
              style={selected ? { color: l.accent } : undefined}
            >
              <span
                className={`font-mono text-xs tabular-nums transition-opacity ${
                  selected ? "opacity-100" : "opacity-40"
                }`}
              >
                {l.index}
              </span>
              <span
                className={`text-lg font-semibold tracking-tight transition-colors md:text-xl ${
                  selected ? "" : "text-muted-foreground group-hover:text-foreground"
                }`}
              >
                {l.name}
              </span>
              {/* progress hairline while auto-cycling */}
              {selected && !engaged && !reduce && (
                <motion.span
                  key={`progress-${active}`}
                  className="absolute bottom-0 left-0 h-px"
                  style={{ background: l.accent }}
                  initial={{ width: "0%" }}
                  animate={{ width: "100%" }}
                  transition={{ duration: 5.2, ease: "linear" }}
                />
              )}
              {selected && (engaged || reduce) && (
                <span
                  className="absolute bottom-0 left-0 h-px w-full"
                  style={{ background: l.accent }}
                />
              )}
            </button>
          );
        })}
      </div>

      {/* Detail panel */}
      <div className="relative min-h-[20rem] overflow-hidden rounded-2xl border border-border/60 bg-card/60">
        {/* accent wash, top-right */}
        <div
          aria-hidden
          className="pointer-events-none absolute -right-24 -top-24 size-72 rounded-full opacity-[0.13] blur-3xl transition-colors duration-700"
          style={{ background: lens.accent }}
        />
        <AnimatePresence mode="wait">
          <motion.div
            key={lens.id}
            role="tabpanel"
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 18, filter: "blur(6px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: -12, filter: "blur(6px)" }}
            transition={{ duration: 0.45, ease: EASE }}
            className="relative flex h-full flex-col gap-6 p-6 md:p-9"
          >
            <p className="text-balance text-xl font-medium leading-snug md:text-2xl">
              {lens.question}
            </p>

            <ul className="flex flex-col gap-2.5">
              {lens.examine.map((item, i) => (
                <li key={i} className="flex items-start gap-3 text-sm text-foreground/85 md:text-base">
                  <span
                    aria-hidden
                    className="mt-[0.55em] size-1.5 shrink-0 rounded-full"
                    style={{ background: lens.accent }}
                  />
                  {item}
                </li>
              ))}
            </ul>

            <p className="font-mono text-xs leading-relaxed text-muted-foreground">
              <span className="uppercase tracking-[0.18em]" style={{ color: lens.accent }}>
                {evidenceLabel}
              </span>{" "}
              — {lens.evidence}
            </p>

            <figure className="mt-auto rounded-lg border border-border/60 bg-background/60 p-4">
              <figcaption className="mb-1.5 font-mono text-[0.65rem] uppercase tracking-[0.2em] text-muted-foreground">
                {findingLabel}
              </figcaption>
              <blockquote className="text-sm italic leading-relaxed text-foreground/80">
                {lens.finding}
              </blockquote>
            </figure>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

/**
 * TimelineTrack — the 7 days as a drawn line with staggered nodes.
 * Horizontal on desktop, vertical rail on mobile.
 */
export function TimelineTrack({
  items,
}: {
  items: { day: string; title: string; detail: string }[];
}) {
  const reduce = useReducedMotion();

  return (
    <div className="relative">
      {/* Desktop: horizontal */}
      <div className="hidden md:block">
        <div className="relative mb-8 h-px w-full bg-border/60">
          <motion.div
            className="absolute inset-y-0 left-0 bg-gradient-to-r from-cyan via-cyan to-violet"
            initial={{ width: reduce ? "100%" : "0%" }}
            whileInView={{ width: "100%" }}
            viewport={{ once: true, margin: "-100px" }}
            transition={{ duration: 1.6, ease: EASE }}
          />
        </div>
        <div className="grid grid-cols-6 gap-5">
          {items.map((item, i) => (
            <motion.div
              key={i}
              initial={reduce ? { opacity: 0 } : { opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-100px" }}
              transition={{ duration: 0.6, delay: 0.25 + i * 0.18, ease: EASE }}
              className="relative flex flex-col gap-1.5"
            >
              <span
                aria-hidden
                className="absolute -top-[2.32rem] left-0 size-2 rounded-full bg-cyan ring-4 ring-background"
              />
              <span className="font-mono text-[0.65rem] uppercase tracking-[0.2em] text-accent">
                {item.day}
              </span>
              <span className="text-sm font-semibold">{item.title}</span>
              <span className="text-xs leading-relaxed text-muted-foreground">
                {item.detail}
              </span>
            </motion.div>
          ))}
        </div>
      </div>

      {/* Mobile: vertical rail */}
      <div className="flex flex-col gap-0 md:hidden">
        {items.map((item, i) => (
          <motion.div
            key={i}
            initial={reduce ? { opacity: 0 } : { opacity: 0, x: -16 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true, margin: "-60px" }}
            transition={{ duration: 0.5, delay: i * 0.08, ease: EASE }}
            className="relative flex gap-4 pb-7 pl-6 last:pb-0"
          >
            <span
              aria-hidden
              className="absolute left-0 top-1.5 size-2 rounded-full bg-cyan ring-4 ring-background"
            />
            {i < items.length - 1 && (
              <span
                aria-hidden
                className="absolute bottom-0 left-[3.5px] top-4 w-px bg-border/60"
              />
            )}
            <div className="flex flex-col gap-1">
              <span className="font-mono text-[0.65rem] uppercase tracking-[0.2em] text-accent">
                {item.day}
              </span>
              <span className="text-sm font-semibold">{item.title}</span>
              <span className="text-xs leading-relaxed text-muted-foreground">
                {item.detail}
              </span>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

/**
 * CreditSplit — the 50% credit mechanic as one bar that splits.
 * Percentages only: the landing never shows dollar amounts.
 */
export function CreditSplit({
  leftLabel,
  rightLabel,
  windowChip,
}: {
  leftLabel: string;
  rightLabel: string;
  windowChip: string;
}) {
  const reduce = useReducedMotion();

  return (
    <div className="flex flex-col gap-5">
      <div className="relative flex h-20 w-full overflow-hidden rounded-xl border border-border/60 md:h-24">
        <motion.div
          className="relative flex items-center justify-center bg-cyan-deep/30"
          initial={{ flexBasis: reduce ? "50%" : "100%" }}
          whileInView={{ flexBasis: "50%" }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 1.1, delay: 0.4, ease: EASE }}
        >
          <div className="flex flex-col items-center gap-0.5 px-3 text-center">
            <span className="text-2xl font-semibold text-cyan-glow md:text-3xl">
              <CountUp end={50} suffix="%" duration={1400} />
            </span>
            <span className="text-[0.7rem] leading-tight text-foreground/75 md:text-xs">
              {leftLabel}
            </span>
          </div>
          <span
            aria-hidden
            className="absolute inset-y-0 right-0 w-px bg-cyan/60"
          />
        </motion.div>
        <motion.div
          className="flex flex-1 items-center justify-center bg-card/60"
          initial={{ opacity: reduce ? 1 : 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.8, delay: 1.1 }}
        >
          <div className="flex flex-col items-center gap-0.5 px-3 text-center">
            <span className="text-2xl font-semibold text-foreground/80 md:text-3xl">
              50%
            </span>
            <span className="text-[0.7rem] leading-tight text-muted-foreground md:text-xs">
              {rightLabel}
            </span>
          </div>
        </motion.div>
      </div>
      <span className="inline-flex w-fit items-center gap-2 rounded-full border border-cyan/30 bg-cyan/5 px-3.5 py-1.5 font-mono text-[0.65rem] uppercase tracking-[0.18em] text-cyan-glow">
        <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-cyan" />
        {windowChip}
      </span>
    </div>
  );
}
