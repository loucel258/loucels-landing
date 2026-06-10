import { notFound } from "next/navigation";
import Link from "next/link";
import { isLocale } from "@/i18n/config";
import { Pseudo3DHero } from "@/components/hero/pseudo-3d-hero";

export const metadata = {
  title: "Hero preview — Loucels",
  robots: { index: false, follow: false },
};

const dict = {
  en: {
    headline: (
      <>
        AI Architecture <br />
        <span
          style={{
            background: "linear-gradient(90deg, #7C3AED 0%, #06B6D4 100%)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            backgroundClip: "text",
          }}
        >
          Built to Scale
        </span>{" "}
        Your Business.
      </>
    ),
    subhead:
      "Specialized AI agents, governed by default. Bilingual EN/ES, owned by you, deployed in South Florida.",
    primary: "Book a 30-min Diagnosis",
    secondary: "← Back to landing",
  },
  es: {
    headline: (
      <>
        Arquitectura IA <br />
        <span
          style={{
            background: "linear-gradient(90deg, #7C3AED 0%, #06B6D4 100%)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            backgroundClip: "text",
          }}
        >
          Que Escala
        </span>{" "}
        Tu Negocio.
      </>
    ),
    subhead:
      "Agentes IA especializados, gobernados por diseño. Bilingüe EN/ES, tuyos por construcción, desplegados en el Sur de Florida.",
    primary: "Agenda un diagnóstico de 30 min",
    secondary: "← Volver al landing",
  },
} as const;

export default async function HeroPreviewPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = dict[locale];

  return (
    <main className="min-h-screen bg-white">
      <Pseudo3DHero
        headline={t.headline}
        subhead={t.subhead}
        primaryCta={t.primary}
        secondaryCta={t.secondary}
        secondaryHref={`/${locale}`}
      />
      <section className="mx-auto max-w-3xl px-6 py-20 text-center">
        <p className="text-xs uppercase tracking-[0.18em] text-zinc-400">
          Preview · {locale.toUpperCase()}
        </p>
        <h2 className="mt-3 text-2xl font-semibold tracking-tight text-zinc-900">
          What you just saw
        </h2>
        <ul className="mt-6 space-y-2 text-sm text-zinc-600">
          <li>· 3 stacked copies of the same image at different z-depths, blur, opacity</li>
          <li>· Continuous idle floating animation (rotation + breathing scale)</li>
          <li>· Pointer tilt with lerp easing (rAF stops when settled)</li>
          <li>· Cursor-following radial cyan/violet glow in the background</li>
          <li>· Specular glare that travels opposite the tilt</li>
          <li>· Gyroscope on mobile (iOS shows an &quot;Enable motion&quot; button)</li>
          <li>· Respects <code>prefers-reduced-motion</code></li>
        </ul>
        <Link
          href={`/${locale}`}
          className="mt-10 inline-block rounded-full border border-zinc-200 px-6 py-3 text-sm font-medium text-zinc-900 transition-colors hover:bg-zinc-50"
        >
          ← Back to landing
        </Link>
      </section>
    </main>
  );
}
