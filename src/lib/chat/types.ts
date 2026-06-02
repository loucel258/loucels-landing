// Shared types between the chat API route and the client widget.
// No runtime imports here — keep this file safe for both client and server bundles.

import type { Locale } from "@/i18n/config";

export type ChatRole = "user" | "assistant";

export type ChatMessage = {
  role: ChatRole;
  content: string;
};

export type ChatRequest = {
  locale: Locale;
  messages: ChatMessage[];
  sessionId?: string;
};

export type ChatErrorCode =
  | "bad_request"
  | "rate_limited"
  | "origin_blocked"
  | "input_too_long"
  | "pii_blocked"
  | "chat_unavailable"
  | "chat_failed";

export type BookingPayload = {
  name: string;
  email: string;
  reason: string;
  preferredWindow?: string;
};

export type ChatResponse =
  | { ok: true; reply: string; bookingLink?: string }
  | { ok: false; error: ChatErrorCode };
