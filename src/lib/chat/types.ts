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

/**
 * GAP-F3 closure — escalate_to_human surfaces the HITL pattern that Loucels's
 * marketing claims, *within this very chat* (not only inside builds for
 * customers). When the agent encounters a situation it can't or shouldn't
 * handle alone (sensitive vertical, edge case beyond scope, customer
 * frustration, ambiguous high-stakes question), it stages an escalation
 * and the response is a notice that Steven was notified — instead of
 * a half-confident answer.
 */
export type EscalationPayload = {
  reason: "out_of_scope" | "sensitive_topic" | "frustrated_visitor" | "ambiguous_high_stakes" | "agent_uncertain";
  summary: string;     // one-line for Steven's queue
  name?: string;
  email?: string;
};

export type ChatResponse =
  | { ok: true; reply: string; bookingLink?: string }
  | { ok: false; error: ChatErrorCode };
