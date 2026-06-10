"use client";

import { useCallback } from "react";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/**
 * BookViaChatButton — opens the chat with a pre-filled "I want to book"
 * prompt instead of going directly to Cal.com.
 *
 * Closes GAP-A1 from the workflow-architect report. Previously, the hero
 * CTA, the CTA section button, and the subpage hero CTA all linked
 * directly to `siteConfig.calUrl`, so ~50% of bookings never appeared in
 * the chat audit chain and the `leads` table.
 *
 * Hybrid pattern (option C from decisions-pending.md):
 *   1. Visitor clicks CTA → fires `loucels:open-chat` event with a
 *      booking-intent prompt
 *   2. Chat agent receives the message, calls `request_booking` tool
 *   3. Tool handler persists the lead row AND returns the Cal.com link
 *   4. Agent's reply contains the link; visitor clicks → books on Cal
 *   5. Cal.com webhook fires `BOOKING_CREATED` → lead status transitions
 *
 * Net result: 100% audit coverage. Net friction: one extra agent message
 * (~5 seconds). Trade-off documented in decisions-pending.md.
 *
 * Reuses the existing `loucels:open-chat` custom event already listened to
 * by chat-widget.tsx (originally added for the templates section cards).
 */

export function BookViaChatButton({
  className,
  children,
  customPrompt,
}: {
  className?: string;
  children: ReactNode;
  /** Override the default booking prompt (e.g., for context-specific subpages). */
  customPrompt?: string;
}) {
  const pathname = usePathname();
  // Locale is determined by URL — /es/* paths get the Spanish prompt;
  // anything else (including bare "/") gets English. Robust because the
  // root layout currently hardcodes lang="en".
  const isEs = pathname?.startsWith("/es") ?? false;

  const handleClick = useCallback(() => {
    if (typeof window === "undefined") return;
    const prompt =
      customPrompt ??
      (isEs
        ? "Quiero agendar una llamada de discovery de 30 minutos. ¿Cómo lo hacemos?"
        : "I want to book a 30-min discovery call. How do we do this?");
    window.dispatchEvent(
      new CustomEvent("loucels:open-chat", { detail: { prompt } }),
    );
  }, [customPrompt, isEs]);

  return (
    <button type="button" onClick={handleClick} className={className}>
      {children}
    </button>
  );
}
