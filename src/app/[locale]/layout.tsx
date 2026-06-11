import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { locales, isLocale, type Locale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import Script from "next/script";
import { siteConfig } from "@/lib/site-config";
import { StructuredData } from "@/components/structured-data";

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
  const dict = getDictionary(locale);

  return {
    metadataBase: new URL(siteConfig.url),
    title: dict.meta.title,
    description: dict.meta.description,
    applicationName: siteConfig.name,
    authors: [{ name: siteConfig.name }],
    creator: siteConfig.name,
    publisher: siteConfig.name,
    alternates: {
      canonical: `/${locale}`,
      languages: Object.fromEntries(
        locales.map((l) => [l, `/${l}`]),
      ),
    },
    openGraph: {
      type: "website",
      url: `${siteConfig.url}/${locale}`,
      title: dict.meta.title,
      description: dict.meta.description,
      siteName: siteConfig.name,
      locale: locale === "es" ? "es_ES" : "en_US",
      images: [
        {
          url: siteConfig.ogImage,
          width: 1200,
          height: 630,
          alt: siteConfig.name,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: dict.meta.title,
      description: dict.meta.description,
      creator: siteConfig.twitter,
      images: [siteConfig.ogImage],
    },
    robots: {
      index: true,
      follow: true,
      googleBot: {
        index: true,
        follow: true,
        "max-image-preview": "large",
        "max-snippet": -1,
      },
    },
  };
}

export default async function LocaleLayout({
  children,
  params,
}: Readonly<{
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}>) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  // Dogfood: the marketing site embeds the SAME widget we ship to
  // clients, pointed at the multi-tenant agent. The slug is env-driven
  // so dev uses the localhost-allowed agent while prod uses the real
  // one. CTA buttons keep working: agent.js listens for the same
  // `loucels:open-chat` event the legacy chat used.
  const agentSlug = process.env.NEXT_PUBLIC_AGENT_SLUG ?? "loucels-landing";

  return (
    <>
      <StructuredData locale={locale} />
      {children}
      <Script
        src="/agent.js"
        data-agent={agentSlug}
        data-lang={locale}
        strategy="afterInteractive"
      />
    </>
  );
}

export type LocaleLayoutProps = { locale: Locale };
