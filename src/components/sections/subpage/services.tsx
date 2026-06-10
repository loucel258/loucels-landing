"use client";

import {
  Bot,
  Compass,
  FileText,
  Globe,
  Layers,
  LineChart,
  MessageSquare,
  Quote,
  ShieldCheck,
  Sparkles,
  Star,
  Wrench,
} from "lucide-react";
import { Reveal, StaggerGroup, StaggerItem } from "@/components/motion/reveal";
import { TiltCard } from "@/components/motion/tilt-card";
import type { Dictionary } from "@/i18n/dictionaries/en";
import { SectionRay } from "./section-ray";

/**
 * SubpageServices — denser, more interactive card grid for subpage offers.
 *
 * Each item gets:
 *  - A name-matched icon badge (helps the visitor identify the service visually,
 *    not just by reading the title)
 *  - TiltCard wrapper (subtle cursor-follow tilt; glare off because the cyan
 *    glow ring on hover would clash with white sheen)
 *  - Animated stagger entrance via StaggerGroup
 *  - Border ring that ignites on hover
 *
 * Icons are matched by keyword in the item.name — keeps the component generic
 * across subpages without hardcoding slug→icon maps from the parent.
 */

function iconForName(name: string): React.ReactNode {
  const lower = name.toLowerCase();
  if (lower.includes("front desk")) return <MessageSquare className="size-4" strokeWidth={1.7} />;
  if (lower.includes("quote") || lower.includes("cotiza")) return <Quote className="size-4" strokeWidth={1.7} />;
  if (lower.includes("review") || lower.includes("reseña")) return <Star className="size-4" strokeWidth={1.7} />;
  if (lower.includes("gap") || lower.includes("audit") || lower.includes("auditoría")) return <Compass className="size-4" strokeWidth={1.7} />;
  if (lower.includes("landing")) return <Globe className="size-4" strokeWidth={1.7} />;
  if (lower.includes("redesign") || lower.includes("rediseño") || lower.includes("infrastructure")) return <Wrench className="size-4" strokeWidth={1.7} />;
  if (lower.includes("seo")) return <LineChart className="size-4" strokeWidth={1.7} />;
  if (lower.includes("geo") || lower.includes("optimization") || lower.includes("optimización")) return <Sparkles className="size-4" strokeWidth={1.7} />;
  if (lower.includes("governance") || lower.includes("gobernanza")) return <ShieldCheck className="size-4" strokeWidth={1.7} />;
  if (lower.includes("architecture") || lower.includes("arquitectura")) return <Layers className="size-4" strokeWidth={1.7} />;
  if (lower.includes("implementation") || lower.includes("implementación")) return <Bot className="size-4" strokeWidth={1.7} />;
  return <FileText className="size-4" strokeWidth={1.7} />;
}

export function SubpageServices({
  data,
  accent = "cyan",
}: {
  data: Dictionary["webFoundation"]["services"];
  accent?: "cyan" | "violet";
}) {
  const isViolet = accent === "violet";
  const accentVar = isViolet ? "var(--accent-violet)" : "var(--accent-cyan)";
  const eyebrowClass = isViolet ? "text-violet" : "text-cyan";
  const indexClass = isViolet ? "text-violet" : "text-cyan";
  const hoverBorder = isViolet ? "hover:border-violet/40" : "hover:border-cyan/40";
  const iconBg = isViolet
    ? "border-violet/40 bg-violet/10 text-violet"
    : "border-cyan/40 bg-cyan/10 text-cyan";
  const lineGradient = isViolet
    ? "bg-gradient-to-r from-violet/40 to-transparent"
    : "bg-gradient-to-r from-cyan/40 to-transparent";

  return (
    <section className="relative isolate overflow-hidden py-24 md:py-32">
      <SectionRay color="cyan" direction="lr" delay={0.6} />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-border-soft to-transparent"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -left-32 top-1/2 size-[420px] -translate-y-1/2 rounded-full opacity-25 blur-[140px]"
        style={{
          background: `radial-gradient(circle, color-mix(in oklab, ${accentVar} 55%, transparent), transparent 70%)`,
        }}
      />

      <div className="container-page relative z-10">
        <Reveal className="flex max-w-2xl flex-col gap-5">
          <span className={`text-micro ${eyebrowClass}`}>// {data.eyebrow}</span>
          <h2 className="text-display-2 text-balance text-text-primary">
            {data.title}
          </h2>
        </Reveal>

        <StaggerGroup className="mt-16 grid grid-cols-1 gap-6 md:grid-cols-2 md:gap-8">
          {data.items.map((item, i) => (
            <StaggerItem key={item.name}>
              <TiltCard maxTilt={5} glare={false} className="h-full">
                <article
                  className={`group relative flex h-full flex-col gap-5 rounded-2xl border border-border-soft bg-surface/60 p-7 backdrop-blur-sm transition-all duration-500 hover:bg-surface-2 md:p-9 ${hoverBorder}`}
                  style={{ transitionTimingFunction: "cubic-bezier(0.16, 1, 0.3, 1)" }}
                >
                  {/* Accent hover ring */}
                  <span
                    aria-hidden
                    className="pointer-events-none absolute -inset-px rounded-2xl opacity-0 transition-opacity duration-500 group-hover:opacity-100"
                    style={{
                      boxShadow: `0 0 0 1px ${accentVar}, 0 0 40px -4px color-mix(in oklab, ${accentVar} 45%, transparent), 0 8px 32px -8px color-mix(in oklab, ${accentVar} 25%, transparent)`,
                    }}
                  />

                  {/* Top row: icon badge + index + accent line */}
                  <div className="flex items-center gap-4">
                    <span
                      aria-hidden
                      className={`flex size-9 shrink-0 items-center justify-center rounded-lg border ${iconBg}`}
                    >
                      {iconForName(item.name)}
                    </span>
                    <span className={`text-mono-xs tabular-nums ${indexClass}`}>
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span
                      aria-hidden
                      className={`h-px flex-1 ${lineGradient}`}
                    />
                  </div>

                  <h3 className="text-h3 text-balance text-text-primary">
                    {item.name}
                  </h3>
                  <p className="text-body text-pretty text-text-secondary">
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
