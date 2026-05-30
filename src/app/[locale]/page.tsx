import { notFound } from "next/navigation";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { SmoothScroll } from "@/components/smooth-scroll";
import { ScrollProgress } from "@/components/scroll-progress";
import { Nav } from "@/components/nav";
import { Hero } from "@/components/sections/hero";
import { Manifesto } from "@/components/sections/manifesto";
import { Offer } from "@/components/sections/offer";
import { WhyUs } from "@/components/sections/why-us";
import { Process } from "@/components/sections/process";
import { Architecture } from "@/components/sections/architecture";
import { FAQ } from "@/components/sections/faq";
import { CTA } from "@/components/sections/cta";
import { Footer } from "@/components/sections/footer";

export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const dict = getDictionary(locale);

  return (
    <>
      <SmoothScroll />
      <ScrollProgress />
      <Nav locale={locale} dict={dict} />
      <main className="relative bg-bg">
        <Hero dict={dict} />
        <Offer dict={dict} />
        <Manifesto dict={dict} />
        <WhyUs dict={dict} />
        <Process dict={dict} />
        <Architecture dict={dict} locale={locale} />
        <FAQ dict={dict} />
        <CTA dict={dict} />
        <Footer dict={dict} locale={locale} />
      </main>
    </>
  );
}
