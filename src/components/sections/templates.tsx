"use client";

import { useCallback } from "react";
import {
  Building2,
  ChefHat,
  HardHat,
  Hotel,
  Smile,
  Sparkles,
  Briefcase,
  ArrowUpRight,
} from "lucide-react";
import { Reveal, StaggerGroup, StaggerItem } from "@/components/motion/reveal";
import type { Dictionary } from "@/i18n/dictionaries/en";

/**
 * Templates — vertical-specific service templates.
 *
 * Cards show the same SMV / Integration service applied to a real vertical
 * (MedSpas, Dental, Roofing, etc.) with the actual tools that vertical uses.
 * Clicking a card dispatches a `loucel:open-chat` custom event the chat
 * widget listens for — opening the chat with the template's question
 * pre-loaded so the agent continues the conversation with context.
 *
 * Visual intent borrowed from Zapier's templates gallery: the visitor sees
 * "ah, there's one PRECISELY for my industry with MY apps" before pricing
 * or trust noise enters the picture. Conversion lift sits here, not in
 * generic "AI Front Desk" copy.
 */

const ICONS: Record<string, React.ComponentType<{ size?: number; strokeWidth?: number }>> = {
  "medspa-front-desk": Sparkles,
  "dental-front-desk": Smile,
  "roofing-quote-accelerator": HardHat,
  "restaurant-review-manager": ChefHat,
  "hotel-front-desk": Hotel,
  "wealth-compliance-intake": Briefcase,
};

export function Templates({ dict }: { dict: Dictionary }) {
  const openChatWithPrompt = useCallback((prompt: string) => {
    if (typeof window === "undefined") return;
    window.dispatchEvent(
      new CustomEvent("loucel:open-chat", { detail: { prompt } }),
    );
  }, []);

  return (
    <section
      id="templates"
      className="relative isolate overflow-hidden py-28 md:py-36"
    >
      {/* Soft ambient — cyan top-left, violet bottom-right (subtle) */}
      <div
        aria-hidden
        className="pointer-events-none absolute -left-32 top-32 size-[420px] rounded-full opacity-20 blur-[120px]"
        style={{
          background:
            "radial-gradient(circle, color-mix(in oklab, var(--accent-cyan) 60%, transparent), transparent 70%)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -right-32 bottom-32 size-[380px] rounded-full opacity-15 blur-[120px]"
        style={{
          background:
            "radial-gradient(circle, color-mix(in oklab, var(--accent-violet) 60%, transparent), transparent 70%)",
        }}
      />

      <div className="container-page relative z-10 flex flex-col gap-14">
        <Reveal className="flex flex-col items-center gap-5 text-center">
          <div className="flex items-center gap-3">
            <span aria-hidden className="size-1 rounded-full bg-cyan" />
            <span className="text-micro text-cyan">
              // {dict.templates.eyebrow}
            </span>
          </div>
          <h2 className="text-display-2 max-w-3xl text-balance text-text-primary">
            {dict.templates.title}
          </h2>
          <p className="max-w-xl text-body-md text-balance text-text-secondary">
            {dict.templates.intro}
          </p>
        </Reveal>

        <StaggerGroup
          className="grid gap-5 md:grid-cols-2 lg:grid-cols-3"
          stagger={0.1}
        >
          {dict.templates.items.map((tpl) => {
            const Icon = ICONS[tpl.slug] ?? Building2;
            return (
              <StaggerItem key={tpl.slug} preset="slideInRight">
                <button
                  type="button"
                  onClick={() => openChatWithPrompt(tpl.chatPrompt)}
                  className="group relative flex h-full w-full flex-col gap-4 rounded-2xl border border-border-soft bg-surface p-6 text-left transition-all duration-300 hover:-translate-y-1 hover:border-cyan hover:bg-surface-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
                  style={{
                    transitionTimingFunction: "cubic-bezier(0.16, 1, 0.3, 1)",
                  }}
                >
                  {/* Cyan glow ring on hover */}
                  <span
                    aria-hidden
                    className="pointer-events-none absolute -inset-px rounded-2xl opacity-0 transition-opacity duration-300 group-hover:opacity-100"
                    style={{
                      boxShadow:
                        "0 0 0 1px var(--accent-cyan), 0 0 36px -4px color-mix(in oklab, var(--accent-cyan) 45%, transparent), 0 8px 28px -8px color-mix(in oklab, var(--accent-cyan) 25%, transparent)",
                    }}
                  />

                  {/* Top row: icon + arrow */}
                  <div className="flex items-start justify-between">
                    <span
                      aria-hidden
                      className="flex size-9 items-center justify-center rounded-lg border border-border-soft bg-cyan/10 text-cyan"
                    >
                      <Icon size={18} strokeWidth={1.5} />
                    </span>
                    <ArrowUpRight
                      aria-hidden
                      size={16}
                      strokeWidth={1.5}
                      className="text-text-tertiary transition-all duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-cyan"
                    />
                  </div>

                  {/* Vertical eyebrow + service title */}
                  <div className="flex flex-col gap-1.5">
                    <span className="text-mono-xs uppercase tracking-wider text-cyan">
                      {tpl.vertical}
                    </span>
                    <h3 className="text-h4 leading-tight text-text-primary">
                      {tpl.service}
                    </h3>
                  </div>

                  {/* Description */}
                  <p className="flex-1 text-body-sm text-pretty text-text-secondary">
                    {tpl.description}
                  </p>

                  {/* Tool chips */}
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {tpl.tools.map((tool, i) => (
                      <span
                        key={i}
                        className="rounded-md border border-border-soft bg-bg/40 px-2 py-0.5 text-mono-xs text-text-tertiary"
                      >
                        {tool}
                      </span>
                    ))}
                  </div>
                </button>
              </StaggerItem>
            );
          })}
        </StaggerGroup>

        <Reveal className="flex justify-center">
          <p className="text-mono-xs uppercase tracking-wider text-text-tertiary">
            {dict.templates.ctaHint}
          </p>
        </Reveal>
      </div>
    </section>
  );
}
