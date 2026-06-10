import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { locales, defaultLocale } from "@/i18n/config";

function detectLocale(request: NextRequest): string {
  const accept = request.headers.get("accept-language") ?? "";
  const preferred = accept.split(",")[0]?.split("-")[0]?.toLowerCase();
  if (preferred && (locales as readonly string[]).includes(preferred)) {
    return preferred;
  }
  return defaultLocale;
}

// Paths that bypass locale routing entirely (internal sales demos, etc.)
const LOCALE_BYPASS_PREFIXES = ["/demo", "/admin", "/portal"];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Trust Stack demos and other internal-only routes skip the locale rewrite.
  if (LOCALE_BYPASS_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    // Propagate pathname as a request header so Server Components can
    // read it (Sidebar shell uses this to highlight the active item).
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("x-pathname", pathname);
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  const hasLocale = locales.some(
    (loc) => pathname === `/${loc}` || pathname.startsWith(`/${loc}/`),
  );
  if (hasLocale) return NextResponse.next();

  const locale = detectLocale(request);
  const url = request.nextUrl.clone();
  url.pathname = `/${locale}${pathname === "/" ? "" : pathname}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next|api|.*\\..*).*)"],
};
