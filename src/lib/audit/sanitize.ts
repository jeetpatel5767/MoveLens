// src/lib/audit/sanitize.ts
// Strips Move comments AND string literals before pattern matching.
// Used by Layer 1 (regex rules) and Layer 4 (snippets sent to sidecar).
// Fixes: ML-ACC-001 cross-comment bypass, ML-INT-004 comment-slash false positive,
// ML-UPG-004 "UpgradeCap" in comment false positive.

/**
 * Remove Move block/line comments and string literals from `source`.
 *
 * @param source      Raw Move source code.
 * @param preserveLines  When true, replaced characters are turned into spaces
 *                       (newlines kept intact) so that line numbers computed
 *                       against the returned string stay aligned with the
 *                       original.  Use true for Layer 1 regex matching.
 *                       When false, content is removed/collapsed — use for
 *                       Layer 4 sidecar calls where line numbers don't matter.
 */
export function sanitizeForPatterns(source: string, preserveLines = false): string {
  let out = source;

  if (preserveLines) {
    // Replace matched content with spaces, keeping \n characters intact
    // so line offsets remain correct.
    out = out.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
    out = out.replace(/\/\/[^\n]*/g,       (m) => " ".repeat(m.length));
    out = out.replace(/b?"(?:[^"\\]|\\.)*"/g, (m) => m.replace(/[^\n]/g, " "));
  } else {
    // Remove completely — compact form for embedding/classification.
    out = out.replace(/\/\*[\s\S]*?\*\//g, "");
    out = out.replace(/\/\/[^\n]*/g, "");
    out = out.replace(/b?"(?:[^"\\]|\\.)*"/g, '""');
  }

  return out;
}
