import type { PIIType } from "./patterns";

/**
 * Layer 1.5 — Context-aware PII detector (bilingual EN/ES).
 *
 * Why this exists:
 * ----------------
 * Strict regex (Layer 1) requires PII to match an exact format. The moment
 * someone types `123-45-678` (missing one digit), `123 45 6789` (spaces
 * instead of dashes), or `123456789` (no separators), the strict pattern
 * does not match and partial PII slips through to the model and to logs.
 *
 * This module closes that gap WITHOUT inviting a flood of false positives.
 * The trick is to demand CONTEXT — we only redact a relaxed-format digit
 * sequence when a sensitive keyword (in English OR Spanish) appears within
 * a small window before it.
 *
 *   "mi seguro social es 123-45-678"     → SSN captured
 *   "SSN: 123 45 6789"                    → SSN captured
 *   "order number 123-45-6789"            → NOT captured (no sensitive label)
 *
 * Tradeoff: we accept occasional false positives on sentences like
 * "social media account 12345" because a leaked SSN is far costlier than a
 * sanitized "social media" mention.
 *
 * Layer 2 (Microsoft Presidio + Claude/Llama Guard classifier) will catch
 * spelled-out numbers, OCR-corrupted text, and bare digit sequences without
 * context labels. Documented in /demo/dlp Production Architecture callout.
 */

export type ContextRedaction = {
  type: PIIType;
  label: string;
  match: string;
  replacement: string;
  start: number;
  end: number;
};

const CONTEXT_WINDOW = 60; // chars between end of keyword and start of digits

type KeywordGroup = {
  type: PIIType;
  label: string;
  replacement: string;
  keywords: string[];
};

/**
 * Bilingual keyword catalog. Each list is lower-cased on first use.
 * Order matters: more specific keywords (e.g. "social security number")
 * should appear before more general ones ("social security") to bias the
 * first-match logic in their favor.
 */
const KEYWORD_GROUPS: KeywordGroup[] = [
  {
    type: "SSN",
    label: "Contextual Social Security Number",
    replacement: "[REDACTED_SSN]",
    keywords: [
      "social security number",
      "social security #",
      "social security",
      "ssn#",
      "ssn:",
      "ssn ",
      "ss#",
      "número del seguro social",
      "numero del seguro social",
      "número de seguro social",
      "numero de seguro social",
      "seguro social",
    ],
  },
  {
    type: "ITIN",
    label: "Contextual ITIN",
    replacement: "[REDACTED_ITIN]",
    keywords: [
      "individual taxpayer identification",
      "itin#",
      "itin:",
      "itin ",
      "número itin",
      "numero itin",
      "tax id personal",
    ],
  },
  {
    type: "EIN",
    label: "Contextual EIN",
    replacement: "[REDACTED_EIN]",
    keywords: [
      "employer identification number",
      "federal tax id",
      "federal ein",
      "ein#",
      "ein:",
      "ein ",
      "número del empleador",
      "numero del empleador",
      "número federal del empleador",
      "id federal de empleador",
    ],
  },
  {
    type: "CREDIT_CARD",
    label: "Contextual Credit Card",
    replacement: "[REDACTED_CARD]",
    keywords: [
      "credit card number",
      "credit card #",
      "card number",
      "card #",
      "número de tarjeta",
      "numero de tarjeta",
      "tarjeta de crédito",
      "tarjeta de credito",
      // Bare "card" / "tarjeta" + digits nearby. Defensive: catches cards
      // that fail Luhn validation in Layer 1 (typos, fake numbers, test
      // data) so they still don't reach the model.
      // Trade-off: rare false positives on "library card 12345" etc.
      "credit card",
      "her card",
      "his card",
      "my card",
      "the card",
      "card on file",
      "tarjeta",
      "su tarjeta",
      "mi tarjeta",
      "la tarjeta",
    ],
  },
  {
    type: "US_PHONE",
    label: "Contextual Phone",
    replacement: "[REDACTED_PHONE]",
    keywords: [
      "phone number",
      "phone #",
      "cell number",
      "mobile number",
      "número de teléfono",
      "numero de telefono",
      "teléfono celular",
      "telefono celular",
    ],
  },
];

/**
 * Match a relaxed digit sequence: 5–18 chars containing digits with optional
 * separators. Negative lookbehind/ahead prevents capturing only PART of a
 * longer digit run (e.g., we don't want to match the first 9 of a 12-digit
 * sequence).
 */
const DIGIT_SEQUENCE_RE = /(\b\d[\d\s\-.\/()]{3,16}\d\b)/;

/**
 * For each keyword occurrence, look up to CONTEXT_WINDOW chars ahead for a
 * relaxed digit sequence. If found, emit a Redaction. Case-insensitive on
 * the keyword side, original case preserved on the match.
 */
export function detectContextual(text: string): ContextRedaction[] {
  if (!text) return [];
  const out: ContextRedaction[] = [];
  const lower = text.toLowerCase();

  for (const group of KEYWORD_GROUPS) {
    for (const keyword of group.keywords) {
      const kwLower = keyword.toLowerCase();
      let searchFrom = 0;
      while (true) {
        const idx = lower.indexOf(kwLower, searchFrom);
        if (idx === -1) break;

        const windowStart = idx + kwLower.length;
        const windowEnd = Math.min(windowStart + CONTEXT_WINDOW, text.length);
        const window = text.slice(windowStart, windowEnd);
        const m = DIGIT_SEQUENCE_RE.exec(window);

        if (m && m.index !== undefined) {
          const matchText = m[1];
          // Require ≥5 digits in the candidate to be meaningful PII.
          const digitCount = (matchText.match(/\d/g) ?? []).length;
          if (digitCount >= 5) {
            const matchStart = windowStart + m.index;
            const matchEnd = matchStart + matchText.length;
            out.push({
              type: group.type,
              label: group.label,
              match: matchText,
              replacement: group.replacement,
              start: matchStart,
              end: matchEnd,
            });
          }
        }

        // Advance past this keyword occurrence to find any other instances.
        searchFrom = idx + kwLower.length;
      }
    }
  }
  return out;
}
