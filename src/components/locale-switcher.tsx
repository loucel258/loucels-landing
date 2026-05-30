import Link from "next/link";
import { locales, type Locale } from "@/i18n/config";

export function LocaleSwitcher({ current }: { current: Locale }) {
  return (
    <nav className="flex items-center gap-2 text-xs uppercase tracking-wide">
      {locales.map((locale) => (
        <Link
          key={locale}
          href={`/${locale}`}
          className={
            locale === current
              ? "font-semibold text-foreground"
              : "text-muted-foreground hover:text-foreground"
          }
        >
          {locale}
        </Link>
      ))}
    </nav>
  );
}
