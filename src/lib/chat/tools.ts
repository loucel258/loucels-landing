import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { siteConfig } from "@/lib/site-config";
import type { BookingPayload } from "./types";

export const REQUEST_BOOKING_TOOL: Anthropic.Tool = {
  name: "request_booking",
  description:
    "Call when the visitor signals real intent to talk (asks pricing, scope, timeline, 'how do we start', or describes a clear fit). Gathers their name, email, and reason, and returns a Cal.com link pre-filled with their info. The agent must then send the link in its reply.",
  input_schema: {
    type: "object",
    properties: {
      name: { type: "string", description: "Visitor's full name." },
      email: {
        type: "string",
        description: "Visitor's email address. Validate format.",
      },
      reason: {
        type: "string",
        description:
          "One-line summary of what they want to discuss (e.g., 'AI Front Desk for a 4-clinic dental practice in Jupiter').",
      },
      preferredWindow: {
        type: "string",
        description:
          "Optional. Time-of-day or day-of-week preference if the visitor mentioned one (e.g., 'mornings ET', 'next week').",
      },
    },
    required: ["name", "email", "reason"],
  },
};

/**
 * Handles the request_booking tool call.
 *
 * Returns a Cal.com deep link with **name + notes only** pre-filled. Email is
 * intentionally NOT in the URL — even though Cal.com supports `?email=`, the
 * URL ends up in the visitor's browser history and, more importantly, the
 * visitor may copy the link to share (with an assistant, spouse, etc.). We
 * trade 5 seconds of convenience for not leaking the email if the link is
 * forwarded. The visitor types the email on Cal's form.
 *
 * Future (when CAL_COM_API_KEY is configured): swap this body to hit Cal.com
 * v2 API and book the slot inside the chat with a server-side state token,
 * so no PII ever lands in any URL. The tool contract above does not change —
 * only this handler.
 */
export function handleRequestBooking(payload: BookingPayload): {
  bookingLink: string;
  prefilledFor: string;
} {
  const base = siteConfig.calUrl;
  const params = new URLSearchParams({
    name: payload.name,
    notes: payload.preferredWindow
      ? `${payload.reason} — preferred: ${payload.preferredWindow}`
      : payload.reason,
  });
  return {
    bookingLink: `${base}?${params.toString()}`,
    prefilledFor: payload.name,
  };
}
