// Layer 1 — deterministic rule engine.
// NOW PRODUCES SUSPECTS, NOT FINDINGS.
// Suspects go to the Groq confirmation gate before becoming real findings.
//
// HARD RULES (from CLAUDE.md):
//   - ML-INT-001 (Cetus-class shift overflow) always runs FIRST.
//   - Deduplication: same (rule_id, module, line_start) → keep first.
//   - AST rules (19) and SKIP_MVP rules (9) are skipped; only REGEX rules run.

import { RULES } from "./rules";
import type { Rule } from "./rules";
import type { Suspect } from "./schema";
import type { PackageContext } from "../sui/queries";
import { sanitizeForPatterns } from "./sanitize";

// ──────────────────────────────────────────────────────────────
// Priority-ordered REGEX rule list (ML-INT-001 first)
// ──────────────────────────────────────────────────────────────

const REGEX_RULES: readonly Rule[] = (() => {
  const regex  = RULES.filter((r) => r.type === "regex");
  const cetus  = regex.filter((r) => r.id === "ML-INT-001");
  const others = regex.filter((r) => r.id !== "ML-INT-001");
  return [...cetus, ...others];
})();

// ──────────────────────────────────────────────────────────────
// Line-number helpers
// ──────────────────────────────────────────────────────────────

function buildLineOffsets(source: string): number[] {
  const offsets: number[] = [0];
  for (let i = 0; i < source.length; i++) {
    if (source[i] === "\n") offsets.push(i + 1);
  }
  return offsets;
}

function charIndexToLine(offsets: number[], idx: number): number {
  let lo = 0;
  let hi = offsets.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (offsets[mid] <= idx) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1; // 1-indexed
}

// ──────────────────────────────────────────────────────────────
// Extract the enclosing function name from raw lines above a match
// ──────────────────────────────────────────────────────────────

function extractFunctionName(rawLines: string[], lineStart: number): string | null {
  // Search up to 10 lines back for a function declaration
  const start = Math.max(0, lineStart - 10);
  for (let i = lineStart - 1; i >= start; i--) {
    const m = rawLines[i]?.match(/(?:public\s+(?:entry\s+)?|entry\s+)?fun\s+(\w+)/);
    if (m) return m[1] ?? null;
  }
  return null;
}

// ──────────────────────────────────────────────────────────────
// Pattern matcher — returns all match positions as line ranges
// ──────────────────────────────────────────────────────────────

interface MatchResult {
  lineStart: number; // 1-indexed
  lineEnd:   number; // 1-indexed
  snippet:   string; // matched text, capped at 300 chars
  charIndex: number; // character index for context extraction
}

function matchPattern(source: string, pattern: RegExp): MatchResult[] {
  const results: MatchResult[] = [];
  const offsets = buildLineOffsets(source);

  const flags = pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g";
  const re = new RegExp(pattern.source, flags);
  re.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = re.exec(source)) !== null) {
    const start     = match.index;
    const end       = start + Math.max(match[0].length - 1, 0);
    const lineStart = charIndexToLine(offsets, start);
    const lineEnd   = charIndexToLine(offsets, end);

    results.push({
      lineStart,
      lineEnd,
      snippet:   match[0].slice(0, 300),
      charIndex: start,
    });

    if (match[0].length === 0) re.lastIndex++;
  }

  return results;
}

// ──────────────────────────────────────────────────────────────
// Deduplication: same (rule_id, module, line_start) → keep first
// ──────────────────────────────────────────────────────────────

function deduplicateSuspects(suspects: Suspect[]): Suspect[] {
  const seen = new Set<string>();
  return suspects.filter((s) => {
    const key = `${s.rule_id}:${s.location.module}:${s.location.line_start}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ──────────────────────────────────────────────────────────────
// Public entry point
// ──────────────────────────────────────────────────────────────

/**
 * Run all 65 deterministic REGEX rules against every module in the given
 * PackageContext and return a deduplicated array of Suspects.
 *
 * Suspects are NOT findings — they do NOT affect the score.
 * They are sent to the Groq confirmation gate (gate.ts) which either
 * CONFIRMS them (→ real finding, affects score) or DISMISSES them.
 *
 * Source text preference: module.source (uploaded .move file) first,
 * module.disassembly (fetched from chain) as fallback.
 */
export function runLayer1(ctx: PackageContext): Suspect[] {
  const raw: Suspect[] = [];

  for (const mod of ctx.modules) {
    const rawSource = mod.source ?? mod.disassembly;
    if (!rawSource) continue;

    // Sanitize for matching but keep raw for context extraction (line numbers stay aligned)
    const cleanSource = sanitizeForPatterns(rawSource, true);
    const rawLines    = rawSource.split("\n");

    for (const rule of REGEX_RULES) {
      if (!rule.pattern) continue;

      const matches = matchPattern(cleanSource, rule.pattern);

      for (const m of matches) {
        const lineStart = m.lineStart;
        const lineEnd   = m.lineEnd;

        // Extract CONTEXT (5 lines before + 10 lines after) from RAW source
        // (comments included — Groq needs full context to make a good decision)
        const contextStart = Math.max(0, lineStart - 6);
        const contextEnd   = Math.min(rawLines.length - 1, lineStart + 10);
        const contextLines = rawLines.slice(contextStart, contextEnd + 1).join("\n");

        // Impacted code from raw source (real lines, not sanitized)
        const impactedCode = rawLines.slice(lineStart - 1, lineEnd).join("\n");

        raw.push({
          rule_id:        rule.id,
          severity:       rule.severity,
          title:          rule.description,
          description:    rule.description,
          location: {
            module:     mod.name,
            function:   extractFunctionName(rawLines, lineStart),
            line_start: lineStart,
            line_end:   lineEnd,
          },
          // Flat compatibility fields — mirrors location.* so FindingSchema can parse Suspects
          module:         mod.name,
          line_start:     lineStart,
          line_end:       lineEnd,
          confidence:     1.0 as const,
          impacted_code:  impactedCode || null,
          recommendation: rule.recommendation,
          category:       String(rule.category),
          source:         "layer1" as const,
          matched_text:   m.snippet.slice(0, 200),
          context_lines:  contextLines,
        });
      }
    }
  }

  return deduplicateSuspects(raw);
}
