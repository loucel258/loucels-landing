import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { siteConfig } from "@/lib/site-config";
import type { BookingPayload, EscalationPayload } from "./types";

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

/**
 * GAP-F3 closure: the chat agent now has an explicit "human in the loop"
 * surface. When the conversation crosses a threshold the agent shouldn't
 * cross alone, it calls `escalate_to_human` and we:
 *
 *   1. Persist the lead with status `escalated` (if the visitor provided
 *      contact info) so Steven sees it in /admin/chat-pulse
 *   2. Write a permanent audit row marking the HITL gate firing
 *   3. Return a graceful message telling the visitor a human will follow up
 *
 * This makes Loucels's marketing claim ("HITL on high-risk actions") visible
 * on Loucels's own surface, not just inside builds we ship to customers.
 */
export const ESCALATE_TO_HUMAN_TOOL: Anthropic.Tool = {
  name: "escalate_to_human",
  description:
    "Call when the visitor's situation crosses a threshold you should not handle alone: out-of-scope question (legal/medical/financial advice the visitor mistakenly asks of you), sensitive topic the visitor surfaces emotionally, frustrated visitor who needs an apology and a person, ambiguous high-stakes question where you'd risk being wrong, or your own uncertainty about whether to proceed. Pauses the conversation, notifies Steven, and tells the visitor a human will follow up. Always prefer this over guessing or stalling. Do NOT call this routinely — only when one of the listed conditions actually fits.",
  input_schema: {
    type: "object",
    properties: {
      reason: {
        type: "string",
        enum: [
          "out_of_scope",
          "sensitive_topic",
          "frustrated_visitor",
          "ambiguous_high_stakes",
          "agent_uncertain",
        ],
        description: "Which escalation category applies.",
      },
      summary: {
        type: "string",
        description:
          "One-line summary of what the visitor needs (for Steven's queue). Be specific: 'Wants to discuss billing dispute from a previous engagement' is better than 'frustrated customer'.",
      },
      name: {
        type: "string",
        description:
          "Visitor's name, if they've already provided it in the conversation. Leave blank if not provided.",
      },
      email: {
        type: "string",
        description:
          "Visitor's email if they've already provided it. Leave blank if not provided.",
      },
    },
    required: ["reason", "summary"],
  },
};

export type EscalationResult = {
  acknowledgement: string; // What to tell the visitor
};

/**
 * Handles the escalate_to_human tool call. Returns the message the agent
 * should communicate back to the visitor. The route persists the lead (if
 * contact info available) and writes the audit row.
 */
export function handleEscalateToHuman(
  payload: EscalationPayload,
  locale: "en" | "es",
): EscalationResult {
  // Tailor the acknowledgement to the escalation category. Each category
  // needs a slightly different tone — frustrated visitor needs warmth;
  // out-of-scope needs honesty; sensitive topic needs gravity.
  const messages: Record<EscalationPayload["reason"], { en: string; es: string }> = {
    out_of_scope: {
      en: "That's outside what I'm built to handle reliably. I've flagged it for Steven directly — he'll reach out within one business day so you get a real answer, not a guess from me.",
      es: "Eso está fuera de lo que estoy preparado para manejar de forma confiable. Lo flagueé directamente para Steven — te contactará dentro de un día hábil para que tengas una respuesta real, no una suposición de mi parte.",
    },
    sensitive_topic: {
      en: "I want to make sure this gets the attention it deserves. I've notified Steven so a person follows up directly — please don't continue typing sensitive details here; he'll reach out via a secured channel.",
      es: "Quiero asegurarme de que esto reciba la atención que merece. Le notifiqué a Steven para que una persona haga seguimiento directamente — por favor no sigas tipeando detalles sensibles aquí; te contactará por un canal seguro.",
    },
    frustrated_visitor: {
      en: "I hear you, and I'm not the right channel for this. Steven gets a notification from me right now — he's the founder and will reach out personally to listen properly.",
      es: "Te escucho, y no soy el canal correcto para esto. Steven recibe una notificación mía ahora — es el founder y te contactará personalmente para escucharte como corresponde.",
    },
    ambiguous_high_stakes: {
      en: "This one I want to get right rather than fast. I've handed it off to Steven — he'll follow up within one business day with a precise answer.",
      es: "Esta quiero que salga bien antes que rápido. Le pasé el caso a Steven — hará seguimiento dentro de un día hábil con una respuesta precisa.",
    },
    agent_uncertain: {
      en: "Honestly, I'm not confident enough to answer this without checking. Steven was just notified — he'll follow up within one business day with the actual answer.",
      es: "Honestamente, no tengo suficiente confianza para responder esto sin verificar. Steven acaba de ser notificado — hará seguimiento dentro de un día hábil con la respuesta real.",
    },
  };

  const reply = messages[payload.reason][locale];
  return { acknowledgement: reply };
}
