import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { ArrowLeft, ArrowUpRight, Globe, BrainCircuit, ShieldCheck } from "lucide-react";
import { isLocale, locales } from "@/i18n/config";
import { getServicesByLine } from "@/lib/services-data";

export async function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const isES = locale === "es";
  return {
    title: isES ? "Servicios · Loucells Core" : "Services · Loucells Core",
    description: isES
      ? "Lo que ofrecemos: web foundation y agentes de IA para SMBs en EE.UU."
      : "What we offer: web foundation and AI agents for US SMBs.",
    alternates: {
      canonical: `/${locale}/services`,
      languages: Object.fromEntries(
        locales.map((l) => [l, `/${l}/services`]),
      ),
    },
  };
}

export default async function ServicesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const isES = locale === "es";
  const web = getServicesByLine("web");
  const agents = getServicesByLine("agents");
  const enterprise = getServicesByLine("enterprise");

  return (
    <main className="relative flex min-h-screen flex-col bg-background">
      <header className="border-b border-border/40">
        <div className="container-page flex h-16 items-center justify-between">
          <Link
            href={`/${locale}`}
            className="inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
            {isES ? "Volver" : "Back"}
          </Link>
          <span className="text-sm font-semibold tracking-tight">
            Loucells Core
          </span>
        </div>
      </header>

      <article className="container-page flex max-w-5xl flex-col gap-16 py-16 md:py-24">
        <section className="flex flex-col gap-4">
          <span className="font-mono text-[0.7rem] uppercase tracking-[0.22em] text-accent">
            // {isES ? "Servicios" : "Services"}
          </span>
          <h1 className="text-balance text-4xl font-semibold leading-tight tracking-tight md:text-6xl">
            {isES ? "Lo que ofrecemos" : "What we offer"}
          </h1>
          <p className="max-w-2xl text-pretty text-lg leading-relaxed text-muted-foreground">
            {isES
              ? "Dos líneas que se complementan: la base web que captura atención, los agentes que actúan sobre ella."
              : "Two lines that compound: the web foundation that captures attention, the agents that act on it."}
          </p>
        </section>

        <ServicesGroup
          locale={locale}
          title={isES ? "Base Web" : "Web Foundation"}
          icon={<Globe className="size-4" />}
          items={web}
        />

        <ServicesGroup
          locale={locale}
          title={isES ? "Agentes de IA · SMB" : "AI Agents · SMB"}
          icon={<BrainCircuit className="size-4" />}
          items={agents}
        />

        <ServicesGroup
          locale={locale}
          title={isES ? "Enterprise Architecture" : "Enterprise Architecture"}
          icon={<ShieldCheck className="size-4" />}
          items={enterprise}
          accent="magenta"
        />
      </article>
    </main>
  );
}

function ServicesGroup({
  locale,
  title,
  icon,
  items,
  accent = "cyan",
}: {
  locale: "en" | "es";
  title: string;
  icon: React.ReactNode;
  items: ReturnType<typeof getServicesByLine>;
  accent?: "cyan" | "magenta";
}) {
  return (
    <section className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <span
          className={`flex size-7 items-center justify-center rounded-md ${
            accent === "cyan"
              ? "bg-accent/10 text-accent"
              : "bg-[color:var(--accent-2)]/10 text-[color:var(--accent-2)]"
          }`}
        >
          {icon}
        </span>
        <h2 className="text-2xl font-semibold tracking-tight">{title}</h2>
      </div>
      <div className="grid gap-px overflow-hidden rounded-xl bg-border md:grid-cols-2">
        {items.map((s) => (
          <Link
            key={s.slug}
            href={`/${locale}/services/${s.slug}`}
            className="group flex flex-col gap-3 bg-card p-6 transition-colors hover:bg-muted"
          >
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="text-lg font-semibold leading-tight tracking-tight">
                {s.name[locale]}
              </h3>
              <ArrowUpRight className="size-4 text-muted-foreground transition-all group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-foreground" />
            </div>
            <p className="text-pretty text-sm leading-relaxed text-muted-foreground">
              {s.description[locale]}
            </p>
            <span
              className={`font-mono text-xs uppercase tracking-wider ${
                accent === "cyan"
                  ? "text-accent"
                  : "text-[color:var(--accent-2)]"
              }`}
            >
              {locale === "es"
                ? "Precio en diagnóstico →"
                : "Pricing in diagnostic →"}
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
