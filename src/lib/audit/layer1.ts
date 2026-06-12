// Layer 1 — deterministic rule engine.
// Runs all 65 REGEX rules from rules.ts against each module's source / disassembly.
// confidence = 1.0 (fully deterministic), source = "layer1".
//
// HARD RULES (from CLAUDE.md):
//   - NEVER emit a finding with a rule_id not in VALID_RULE_IDS — drop and log.
//   - ML-INT-001 (Cetus-class shift overflow) always runs FIRST.
//   - Deduplication: same (rule_id, module, line_start) → keep first.
//   - AST rules (19) and SKIP_MVP rules (9) are skipped; only REGEX rules run.

import { RULES } from "./rules";
import type { Rule } from "./rules";
import { FindingSchema } from "./schema";
import type { Finding } from "./schema";
import type { PackageContext } from "../sui/queries";

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

/**
 * Build a cumulative offset array where offsets[i] = character index of the
 * first character on line i+1 (0-indexed array → 1-indexed lines).
 */
function buildLineOffsets(source: string): number[] {
  const offsets: number[] = [0];
  for (let i = 0; i < source.length; i++) {
    if (source[i] === "\n") offsets.push(i + 1);
  }
  return offsets;
}

/**
 * Convert a character index to a 1-indexed line number using binary search.
 */
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
// Pattern matcher — returns all match positions as line ranges
// ──────────────────────────────────────────────────────────────

interface MatchResult {
  lineStart: number; // 1-indexed
  lineEnd: number;   // 1-indexed
  snippet: string;   // matched text, capped at 300 chars
}

function matchPattern(source: string, pattern: RegExp): MatchResult[] {
  const results: MatchResult[] = [];
  const offsets = buildLineOffsets(source);

  // Clone pattern with a fresh lastIndex — never mutate the original rule's RegExp.
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
      snippet: match[0].slice(0, 300),
    });

    // Guard: zero-length match → advance to avoid infinite loop.
    if (match[0].length === 0) re.lastIndex++;
  }

  return results;
}

// ──────────────────────────────────────────────────────────────
// Deduplication: same (rule_id, module, line_start) → keep first
// ──────────────────────────────────────────────────────────────

function deduplicateFindings(findings: Finding[]): Finding[] {
  const seen = new Set<string>();
  return findings.filter((f) => {
    const key = `${f.rule_id}:${f.module}:${f.line_start}`;
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
 * PackageContext and return a deduplicated array of schema-valid Findings.
 *
 * Source text preference: module.source (uploaded .move file) first,
 * module.disassembly (fetched from chain) as fallback.
 */
export function runLayer1(ctx: PackageContext): Finding[] {
  const raw: Finding[] = [];

  for (const mod of ctx.modules) {
    const source = mod.source ?? mod.disassembly;
    if (!source) continue;

    for (const rule of REGEX_RULES) {
      if (!rule.pattern) continue; // AST / SKIP_MVP — already filtered, but defensive

      const matches = matchPattern(source, rule.pattern);

      for (const m of matches) {
        const candidate = {
          rule_id:        rule.id,
          severity:       rule.severity,
          confidence:     1.0 as const,
          source:         "layer1" as const,
          module:         mod.name,
          line_start:     m.lineStart,
          line_end:       m.lineEnd,
          description:    rule.description,
          recommendation: rule.recommendation,
          category:       rule.category,
        };

        // Validate against FindingSchema — drops any finding with an invalid rule_id.
        const parsed = FindingSchema.safeParse(candidate);
        if (!parsed.success) {
          console.warn(
            `[layer1] Dropping invalid finding for rule ${rule.id}:`,
            parsed.error.issues.map((i) => i.message).join("; ")
          );
          continue;
        }

        raw.push(parsed.data);
      }
    }
  }

  return deduplicateFindings(raw);
}
