import { PATTERNS, type PIIType } from "./patterns";
import { detectContextual } from "./context-detector";

export type RedactionSource = "regex" | "context" | "llm";

export type Redaction = {
  type: PIIType | string;
  label: string;
  match: string;
  replacement: string;
  start: number;
  end: number;
  /** Which detection layer produced this redaction. */
  source: RedactionSource;
  /** 0–100. Only meaningful for LLM source; deterministic layers are 100. */
  confidence: number;
};

export type SanitizeResult = {
  original: string;
  sanitized: string;
  redactions: Redaction[];
  stats: {
    totalRedactions: number;
    byType: Record<string, number>;
    bySource: Record<RedactionSource, number>;
    charsTotal: number;
    charsRedacted: number;
  };
  /** Whether Layer 2 was attempted. False if disabled or env missing. */
  layer2Used: boolean;
  /** Whether Layer 2 actually returned a verdict. False if it timed out or
   *  failed silently — Layer 1 is then the only authoritative source. */
  layer2Available: boolean;
};

/**
 * Synchronous sanitizer (Layer 1 + 1.5 only). Use this when you don't want
 * the network round-trip to Anthropic, or when Layer 2 is intentionally
 * disabled.
 */
export function sanitize(rawPrompt: string): SanitizeResult {
  const result = _collectAndApply(rawPrompt, []);
  return { ...result, layer2Used: false, layer2Available: false };
}

// Layer 2 LLM sanitizer lives in `sanitizer-llm.ts` (server-only) so client
// bundles importing `sanitize` for preview don't pull the Anthropic SDK.

/**
 * Shared collection + overlap resolution. Pulls Layer 1 + 1.5 from the
 * deterministic detectors and merges with any pre-computed extra candidates
 * (e.g. Layer 2 LLM redactions passed in from sanitizer-llm.ts).
 *
 * Exported as `_collectAndApply` (underscore = internal) so sanitizer-llm.ts
 * can reuse the dedup + splice logic without us copy-pasting.
 *
 * Overlap resolution preference order:
 *   1. Layer 1 strict regex (lowest rank index in PATTERNS wins)
 *   2. Layer 1.5 contextual
 *   3. Layer 2 LLM (lowest priority — we trust deterministic detectors more)
 */
export function _collectAndApply(
  rawPrompt: string,
  extraCandidates: Redaction[],
): Omit<SanitizeResult, "layer2Used" | "layer2Available"> {
  const candidates: Redaction[] = [];

  // Layer 1 — strict regex (exact formats).
  for (const pattern of PATTERNS) {
    pattern.regex.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pattern.regex.exec(rawPrompt)) !== null) {
      const matchText = m[0];
      if (pattern.validator && !pattern.validator(matchText)) continue;
      candidates.push({
        type: pattern.type,
        label: pattern.label,
        match: matchText,
        replacement: pattern.replacement,
        start: m.index,
        end: m.index + matchText.length,
        source: "regex",
        confidence: 100,
      });
    }
  }

  // Layer 1.5 — bilingual keyword + relaxed-format.
  for (const ctx of detectContextual(rawPrompt)) {
    candidates.push({
      type: ctx.type,
      label: ctx.label,
      match: ctx.match,
      replacement: ctx.replacement,
      start: ctx.start,
      end: ctx.end,
      source: "context",
      confidence: 85,
    });
  }

  // Layer 2 — LLM findings (already converted).
  candidates.push(...extraCandidates);

  // Resolve overlaps. Sort: by start ascending, then by source preference
  // (regex < context < llm), then by pattern rank within regex.
  const sourceRank: Record<RedactionSource, number> = {
    regex: 0,
    context: 1,
    llm: 2,
  };
  candidates.sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start;
    if (a.source !== b.source) return sourceRank[a.source] - sourceRank[b.source];
    const aRank = PATTERNS.findIndex((p) => p.type === a.type);
    const bRank = PATTERNS.findIndex((p) => p.type === b.type);
    return aRank - bRank;
  });

  const accepted: Redaction[] = [];
  for (const c of candidates) {
    const overlapsAccepted = accepted.some(
      (a) => !(c.end <= a.start || c.start >= a.end),
    );
    if (!overlapsAccepted) accepted.push(c);
  }

  // Splice replacements from the end so earlier indices stay valid.
  const sortedDesc = [...accepted].sort((a, b) => b.start - a.start);
  let sanitized = rawPrompt;
  for (const r of sortedDesc) {
    sanitized = sanitized.slice(0, r.start) + r.replacement + sanitized.slice(r.end);
  }

  const byType: Record<string, number> = {};
  const bySource: Record<RedactionSource, number> = { regex: 0, context: 0, llm: 0 };
  let charsRedacted = 0;
  for (const r of accepted) {
    byType[r.type] = (byType[r.type] ?? 0) + 1;
    bySource[r.source] = (bySource[r.source] ?? 0) + 1;
    charsRedacted += r.end - r.start;
  }

  return {
    original: rawPrompt,
    sanitized,
    redactions: accepted,
    stats: {
      totalRedactions: accepted.length,
      byType,
      bySource,
      charsTotal: rawPrompt.length,
      charsRedacted,
    },
  };
}
