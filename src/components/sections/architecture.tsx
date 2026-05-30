"use client";

import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight, ShieldCheck, Eye, Lock } from "lucide-react";
import { Reveal, StaggerGroup, StaggerItem } from "@/components/motion/reveal";
import type { Dictionary } from "@/i18n/dictionaries/en";

/**
 * Architecture — bridge section between Process and CTA.
 *
 * Image is a free-floating, frameless visual on the left that extends INTO
 * the text area on the right. The text sits at z-index above the image, so
 * where they overlap, the image visually passes "behind" the letters.
 *
 * Mask gradient fades the image's edges into the page bg so there's no card
 * boundary — it feels like the image is part of the section's atmosphere.
 */

export function Architecture({
  dict: _dict,
  locale,
}: {
  dict: Dictionary;
  locale: "en" | "es";
}) {
  const es = locale === "es";

  const pillars = [
    {
      icon: <Lock className="size-4" strokeWidth={1.5} />,
      title: es ? "Privacidad Absoluta" : "Absolute Privacy",
      desc: es
        ? "Cero riesgo de fuga de datos. La IA opera en un entorno cerrado y se integra a tus sistemas actuales sin exponer la información confidencial de tus clientes ni de tu negocio."
        : "Zero risk of data leaks. The AI runs in a closed environment and integrates with your current systems without exposing confidential customer or business information.",
    },
    {
      icon: <Eye className="size-4" strokeWidth={1.5} />,
      title: es ? "Registro de Acciones Total" : "Full Action Logging",
      desc: es
        ? "Cada decisión, correo o cotización que ejecuta el sistema queda registrada en un historial transparente. Tú y tu equipo mantienen el control total, sin cajas negras."
        : "Every decision, email, or quote the system executes is logged in a transparent history. You and your team keep full control — no black boxes.",
    },
    {
      icon: <ShieldCheck className="size-4" strokeWidth={1.5} />,
      title: es ? "Seguridad de Nivel Corporativo" : "Enterprise-Grade Security",
      desc: es
        ? "Aplicamos las mismas barreras de seguridad que exigen las grandes corporaciones, adaptadas para que tu negocio opere sin interrupciones, sin vulnerabilidades y desde el día uno."
        : "We apply the same security barriers large corporations demand, adapted so your business operates without interruptions, without vulnerabilities, from day one.",
    },
  ];

  return (
    <section
      id="architecture"
      className="relative isolate overflow-hidden py-32 md:py-40"
    >
      {/* Ambient — sutil dot grid */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-dotgrid opacity-[0.12]"
      />
      {/* Violet ambient glow (subtle) */}
      <div
        aria-hidden
        className="pointer-events-none absolute -left-40 top-1/3 size-[520px] rounded-full opacity-25 blur-[140px]"
        style={{
          background:
            "radial-gradient(circle, color-mix(in oklab, var(--accent-violet) 60%, transparent), transparent 70%)",
        }}
      />

      {/* FLOATING IMAGE — absolute, no frame, extends into text area */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/2 z-0 hidden h-[100%] w-[65%] -translate-x-[82%] -translate-y-1/2 opacity-75 lg:block xl:w-[60%] xl:-translate-x-[80%]"
        style={{
          // Fade ALL edges — image floats freely, no card boundary anywhere
          maskImage:
            "radial-gradient(ellipse 65% 55% at 50% 50%, black 0%, black 45%, transparent 92%)",
          WebkitMaskImage:
            "radial-gradient(ellipse 65% 55% at 50% 50%, black 0%, black 45%, transparent 92%)",
        }}
      >
        <Image
          src="/hero/05-audit.webp"
          alt=""
          fill
          quality={90}
          sizes="(max-width: 1024px) 100vw, 80vw"
          className="object-cover object-center"
        />
      </div>

      {/* MOBILE image (smaller, contained, fallback for narrow screens) */}
      <div
        aria-hidden
        className="container-page relative z-0 mb-12 block lg:hidden"
      >
        <div
          className="relative aspect-[16/10] w-full"
          style={{
            maskImage:
              "radial-gradient(ellipse 80% 75% at 50% 50%, black 38%, transparent 92%)",
            WebkitMaskImage:
              "radial-gradient(ellipse 80% 75% at 50% 50%, black 38%, transparent 92%)",
          }}
        >
          <Image
            src="/hero/05-audit.webp"
            alt=""
            fill
            quality={85}
            sizes="100vw"
            className="object-cover"
          />
        </div>
      </div>

      <div className="container-page relative z-10">
        {/* Content sits on the RIGHT, z-10 above the floating image */}
        <div className="grid grid-cols-1 lg:grid-cols-2 lg:gap-16">
          {/* LEFT empty spacer — image bleeds visually into this area */}
          <div aria-hidden className="hidden lg:block" />

          {/* RIGHT — Content */}
          <div className="relative flex flex-col gap-10">
            <Reveal className="flex flex-col gap-5">
              <span className="text-micro text-cyan">
                // {es ? "Trust Stack" : "Trust Stack"}
              </span>
              <h2 className="text-display-2 text-balance text-text-primary">
                {es
                  ? "Auditable. Seguro. Bajo Tu Control."
                  : "Auditable. Secure. Under Your Control."}
              </h2>
              <p className="text-body-lg max-w-md text-pretty text-text-secondary">
                {es
                  ? "No instalamos «bots» frágiles que se rompen a la primera. Construimos sistemas reales que protegen la información de tu empresa y registran cada acción. Sabrás exactamente qué hace la IA en todo momento."
                  : "We don't install fragile «bots» that break at the first hiccup. We build real systems that protect your company's information and log every action. You'll know exactly what the AI is doing at all times."}
              </p>
            </Reveal>

            <StaggerGroup className="flex flex-col gap-5">
              {pillars.map((pillar, idx) => (
                <StaggerItem key={idx}>
                  <div className="group relative flex gap-4 rounded-xl border border-border-soft bg-surface/70 p-5 backdrop-blur-sm transition-colors duration-300 hover:border-cyan/40 hover:bg-surface-2">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border-soft bg-cyan/10 text-cyan">
                      {pillar.icon}
                    </span>
                    <div className="flex flex-col gap-1.5">
                      <h3 className="text-[15px] font-semibold leading-tight text-text-primary">
                        {pillar.title}
                      </h3>
                      <p className="text-body-sm text-pretty text-text-secondary">
                        {pillar.desc}
                      </p>
                    </div>
                  </div>
                </StaggerItem>
              ))}
            </StaggerGroup>

            <Reveal delay={0.2}>
              <Link
                href="/#agents"
                className="group inline-flex w-fit items-center gap-2.5 rounded-full border border-cyan/40 bg-cyan/10 px-4 py-2 text-mono-xs text-cyan backdrop-blur-sm transition-all duration-200 hover:border-cyan hover:bg-cyan hover:text-bg"
              >
                <ShieldCheck
                  className="size-3.5 transition-colors group-hover:text-bg"
                  strokeWidth={1.5}
                />
                <span>
                  {es
                    ? "EXPLORAR MODELOS SMV"
                    : "EXPLORE SMV MODELS"}
                </span>
                <ArrowUpRight
                  className="size-3 transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
                  strokeWidth={2}
                />
              </Link>
            </Reveal>
          </div>
        </div>
      </div>
    </section>
  );
}
