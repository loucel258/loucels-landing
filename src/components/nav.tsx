"use client";

import Link from "next/link";
import { motion, useScroll, useTransform } from "framer-motion";
import { LocaleSwitcher } from "@/components/locale-switcher";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/dictionaries/en";

/**
 * Editorial Nav — dark slate bar that sits as a fixed editorial element.
 * Always visible, always solid surface, never transparent. Plays the
 * "HEADER bar" role in the editorial hero composition.
 */
export function Nav({
  locale,
  dict,
}: {
  locale: Locale;
  dict: Dictionary;
}) {
  const { scrollY } = useScroll();
  const elevation = useTransform(scrollY, [0, 80], [0, 1]);

  return (
    <motion.header
      className="fixed inset-x-0 top-4 z-50 mx-4 md:mx-6"
      initial={{ y: -16, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.7, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
    >
      <motion.div
        className="relative flex h-14 items-center justify-between rounded-2xl border border-border-soft bg-surface px-5 backdrop-blur-xl md:px-7"
        style={{
          boxShadow: useTransform(
            elevation,
            [0, 1],
            [
              "0 0 0 0 rgba(0,0,0,0)",
              "0 8px 32px -8px rgba(0,0,0,0.5), 0 0 0 1px rgba(248,250,252,0.05)",
            ],
          ),
        }}
      >
        {/* Brand mark */}
        <Link
          href={`/${locale}`}
          className="group inline-flex items-center gap-2.5 text-[14px] font-semibold tracking-tight text-text-primary"
        >
          <span
            aria-hidden
            className="relative inline-flex size-1.5"
          >
            <span className="absolute inset-0 rounded-full bg-cyan" />
            <span className="absolute inset-0 animate-ping rounded-full bg-cyan opacity-60" />
          </span>
          Loucells Core
        </Link>

        {/* Center nav */}
        <nav className="hidden items-center gap-7 text-[13px] text-text-secondary md:flex">
          <NavLink href="#offer">{dict.nav.offer}</NavLink>
          <NavLink href="#philosophy">{dict.nav.philosophy}</NavLink>
          <NavLink href="#agents">{dict.nav.agents}</NavLink>
          <NavLink href="#contact">{dict.nav.contact}</NavLink>
        </nav>

        {/* Right cluster */}
        <div className="flex items-center gap-3">
          <LocaleSwitcher current={locale} />
          <a
            href="#contact"
            className="group relative inline-flex items-center gap-2 overflow-hidden rounded-lg bg-cyan/10 px-3.5 py-1.5 text-[12px] font-medium text-cyan transition-all duration-200 hover:bg-cyan hover:text-bg"
          >
            <span className="relative z-10">Demo</span>
            <span
              aria-hidden
              className="relative z-10 inline-block size-1 rounded-full bg-cyan transition-colors group-hover:bg-bg"
            />
          </a>
        </div>
      </motion.div>
    </motion.header>
  );
}

function NavLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      className="relative text-text-secondary transition-colors duration-200 hover:text-text-primary"
    >
      {children}
    </a>
  );
}
