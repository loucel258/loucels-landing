/**
 * PII pattern catalog for the DLP middleware.
 *
 * Each pattern declares: type, label, regex, optional validator (e.g. Luhn for
 * credit cards), and the replacement token that goes into the sanitized prompt.
 *
 * Patterns are intentionally strict (anchored, with negative lookaheads where
 * appropriate) to minimize false positives. A regex that flags every 9-digit
 * number as an SSN is worse than no regex at all.
 */

export type PIIType =
  | "SSN"
  | "EIN"
  | "ITIN"
  | "CREDIT_CARD"
  | "EMAIL"
  | "US_PHONE"
  | "API_KEY";

export type Pattern = {
  type: PIIType;
  label: string;
  regex: RegExp;
  replacement: string;
  validator?: (match: string) => boolean;
};

/**
 * Luhn algorithm — required to filter out random 13-19 digit numbers that
 * happen to look like credit cards but aren't.
 */
export function isValidLuhn(value: string): boolean {
  const digits = value.replace(/[\s-]/g, "");
  if (!/^\d{13,19}$/.test(digits)) return false;
  let sum = 0;
  let shouldDouble = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = parseInt(digits[i], 10);
    if (shouldDouble) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    shouldDouble = !shouldDouble;
  }
  return sum % 10 === 0;
}

/**
 * SSN — formal format with dashes. Excludes structurally invalid ranges:
 *   - Area number 000, 666, or 900-999 are not assigned by the SSA
 *   - Group number 00 is invalid
 *   - Serial 0000 is invalid
 */
const SSN_REGEX = /\b(?!000|666|9\d{2})\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b/g;

/**
 * EIN — Employer Identification Number, format `XX-XXXXXXX`.
 * IRS-assigned prefixes range 01-99 but exclude a few; we accept the format.
 */
const EIN_REGEX = /\b\d{2}-\d{7}\b/g;

/**
 * ITIN — Individual Taxpayer Identification Number. Always starts with 9,
 * middle group is 70-88 or 90-92 or 94-99. Conservative range here.
 */
const ITIN_REGEX = /\b9\d{2}-(7[0-9]|8[0-8]|9[0-2]|9[4-9])-\d{4}\b/g;

/**
 * Credit card — 13 to 19 digits, optionally separated by spaces or dashes.
 * Final acceptance gated by Luhn validator to avoid false positives.
 */
const CREDIT_CARD_REGEX = /\b(?:\d[ -]*?){13,19}\b/g;

/** RFC-5322 simplified email. */
const EMAIL_REGEX = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

/** US phone — 10 digits with flexible separators, optional +1 country code. */
const US_PHONE_REGEX =
  /(?:\+?1[\s.-]?)?\(?\b[2-9][0-9]{2}\)?[\s.-]?[2-9][0-9]{2}[\s.-]?[0-9]{4}\b/g;

/**
 * Common API key shapes — vendor prefixes we explicitly recognize.
 * Catches the most common formats developers paste accidentally.
 */
const API_KEY_REGEX =
  /\b(?:sk-(?:proj-|ant-|live-)?[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{36}|xoxb-[0-9]+-[0-9]+-[A-Za-z0-9]+|AIza[A-Za-z0-9_-]{35})\b/g;

export const PATTERNS: Pattern[] = [
  {
    type: "SSN",
    label: "Social Security Number",
    regex: SSN_REGEX,
    replacement: "[REDACTED_SSN]",
  },
  {
    type: "ITIN",
    label: "Individual Taxpayer Identification Number",
    regex: ITIN_REGEX,
    replacement: "[REDACTED_ITIN]",
  },
  {
    type: "EIN",
    label: "Employer Identification Number",
    regex: EIN_REGEX,
    replacement: "[REDACTED_EIN]",
  },
  {
    type: "CREDIT_CARD",
    label: "Credit Card",
    regex: CREDIT_CARD_REGEX,
    replacement: "[REDACTED_CARD]",
    validator: isValidLuhn,
  },
  {
    type: "API_KEY",
    label: "API Key / Secret",
    regex: API_KEY_REGEX,
    replacement: "[REDACTED_API_KEY]",
  },
  {
    type: "EMAIL",
    label: "Email Address",
    regex: EMAIL_REGEX,
    replacement: "[REDACTED_EMAIL]",
  },
  {
    type: "US_PHONE",
    label: "US Phone Number",
    regex: US_PHONE_REGEX,
    replacement: "[REDACTED_PHONE]",
  },
];
