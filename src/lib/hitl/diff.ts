/**
 * Tiny line-by-line unified diff. Naive — not Myers — but sufficient for
 * paragraph-level edits like the ones a supervisor makes on a draft quote
 * or email. Output format is GNU-style so any standard diff viewer can
 * render it later if needed.
 */
export function unifiedDiff(original: string, edited: string): string {
  if (original === edited) return "(no changes — supervisor approved verbatim)";

  const a = original.split("\n");
  const b = edited.split("\n");
  const lines: string[] = ["--- agent_draft", "+++ supervisor_edit"];
  const max = Math.max(a.length, b.length);

  for (let i = 0; i < max; i++) {
    const x = a[i];
    const y = b[i];
    if (x === y) {
      if (x !== undefined) lines.push(" " + x);
    } else {
      if (x !== undefined) lines.push("-" + x);
      if (y !== undefined) lines.push("+" + y);
    }
  }
  return lines.join("\n");
}
