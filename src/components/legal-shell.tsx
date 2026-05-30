import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { Locale } from "@/i18n/config";

export function LegalShell({
  locale,
  title,
  updated,
  children,
}: {
  locale: Locale;
  title: string;
  updated: string;
  children: React.ReactNode;
}) {
  const isES = locale === "es";
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
            Loucel Labs
          </span>
        </div>
      </header>
      <article className="container-page flex max-w-3xl flex-col gap-8 py-16">
        <div className="flex flex-col gap-3">
          <span className="font-mono text-[0.7rem] uppercase tracking-[0.22em] text-accent">
            // {isES ? "Legal" : "Legal"}
          </span>
          <h1 className="text-balance text-4xl font-semibold tracking-tight md:text-5xl">
            {title}
          </h1>
          <span className="font-mono text-xs text-muted-foreground">
            {isES ? "Actualizado" : "Updated"} · {updated}
          </span>
        </div>
        <div className="prose prose-invert prose-neutral max-w-none text-pretty leading-relaxed text-foreground/80 [&_a]:text-accent [&_h2]:mb-3 [&_h2]:mt-10 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:text-foreground [&_p]:mb-4 [&_ul]:my-4 [&_ul]:list-disc [&_ul]:pl-6 [&_ul_li]:my-1">
          {children}
        </div>
      </article>
    </main>
  );
}
