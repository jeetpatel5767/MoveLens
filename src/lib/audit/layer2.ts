// Layer 2 — OpenZeppelin DeFi math benchmark (10 deviation checks).
// Compares contract code against OZ safe patterns; fires when dangerous deviations found.
// confidence = 0.95 (near-certain but not byte-for-byte deterministic), source = "layer2".
//
// Rule ML-OZ-001 (Cetus-class: raw << on u256) ALWAYS runs first and sorts to the
// top of any report.  All 10 rules are implemented here.
//
// HARD RULES:
//   - NEVER emit a finding with a rule_id not in VALID_RULE_IDS (enforced by FindingSchema).
//   - All OZ rule IDs (ML-OZ-001..010) are registered in rule-ids.ts.

import { FindingSchema } from "./schema";
import type { Finding, Severity } from "./schema";
import type { PackageContext } from "../sui/queries";

// ──────────────────────────────────────────────────────────────
// OZ rule definitions
// ──────────────────────────────────────────────────────────────

interface OzRule {
  id: string;
  pattern: RegExp;
  severity: Severity;
  ozSafePattern: string;
  description: string;
  recommendation: string;
}

// ML-OZ-001 listed first — it ALWAYS runs first per spec.
const OZ_RULES: OzRule[] = [
  {
    id: "ML-OZ-001",
    // Catches: raw << on any u256 variable  OR  the exact Cetus wrong-mask constant
    pattern: /\bu256\b[^;]*<<\s*\d+|0xffffffffffffffff\s*<<\s*192/gm,
    severity: "critical",
    ozSafePattern: "u256::checked_shl(value, shift)",
    description:
      "Unsafe bit-shift on u256 — use OZ checked_shl. (Cetus class: $223M exploit)",
    recommendation:
      "Replace raw << with openzeppelin_math::u256::checked_shl(value, shift). " +
      "The correct overflow-guard mask is (1u256 << 192) - 1, NOT 0xffffffffffffffff << 192.",
  },
  {
    id: "ML-OZ-002",
    // Catches: raw >> on integer types without checked_shr
    pattern: /\b(?:u256|u128|u64|u32|u16|u8)\b[^;]*>>\s*\d+(?!.*checked_shr)/gm,
    severity: "high",
    ozSafePattern: "u256::checked_shr(value, shift)",
    description: "Raw right-shift on integer without checked_shr — precision loss on small types.",
    recommendation:
      "Use openzeppelin_math::u256::checked_shr(value, shift) to guard against unintended truncation.",
  },
  {
    id: "ML-OZ-003",
    // Catches: (a * b) / denom  without mul_div
    pattern: /\(\s*\w+\s*\*\s*\w+\s*\)\s*\/\s*\w+(?!.*mul_div)/gm,
    severity: "high",
    ozSafePattern: "u256::mul_div(a, b, denom, rounding)",
    description:
      "Direct (a * b) / denom without mul_div — intermediate overflow or precision loss.",
    recommendation:
      "Replace with openzeppelin_math::u256::mul_div(a, b, denom, Rounding::Floor) " +
      "to control overflow behaviour and rounding direction explicitly.",
  },
  {
    id: "ML-OZ-004",
    // Catches: (a * b) >> shift  without mul_shr
    pattern: /\(\s*\w+\s*\*\s*\w+\s*\)\s*>>\s*\d+(?!.*mul_shr)/gm,
    severity: "high",
    ozSafePattern: "u256::mul_shr(a, b, shift, rounding)",
    description: "Direct (a * b) >> shift — intermediate product may overflow before shift.",
    recommendation:
      "Use openzeppelin_math::u256::mul_shr(a, b, shift, Rounding::Floor).",
  },
  {
    id: "ML-OZ-005",
    // Catches: (a + b) / 2  without average()
    pattern: /\(\s*\w+\s*\+\s*\w+\s*\)\s*\/\s*2(?!.*average)/gm,
    severity: "medium",
    ozSafePattern: "u256::average(a, b, rounding)",
    description:
      "(a + b) / 2 overflows when both a and b are near type maximum.",
    recommendation:
      "Use openzeppelin_math::u256::average(a, b, Rounding::Floor) which avoids overflow.",
  },
  {
    id: "ML-OZ-006",
    // Catches: custom modular inverse implementations
    pattern: /(?:mod_exp|modular_inverse|inv_mod)\s*\(/gm,
    severity: "medium",
    ozSafePattern: "u256::inv_mod(value, modulus)",
    description:
      "Custom modular-inverse implementation — often misses edge cases (e.g. value=0).",
    recommendation:
      "Use openzeppelin_math::u256::inv_mod(value, modulus) which handles all edge cases.",
  },
  {
    id: "ML-OZ-007",
    // Catches: custom integer sqrt
    pattern: /(?:isqrt|integer_sqrt|sqrt_floor)\s*\(/gm,
    severity: "low",
    ozSafePattern: "u256::sqrt(value, rounding)",
    description: "Custom integer sqrt — may have off-by-one errors on large values.",
    recommendation:
      "Use openzeppelin_math::u256::sqrt(value, Rounding::Floor).",
  },
  {
    id: "ML-OZ-008",
    // Catches: custom log implementations
    pattern: /(?:ilog2|ilog10|log_base|log2_floor)\s*\(/gm,
    severity: "low",
    ozSafePattern: "u256::log2(value, rounding)",
    description: "Custom logarithm via loop/shift — may return wrong values for edge cases.",
    recommendation:
      "Use openzeppelin_math::u256::log2/log10/log256(value, Rounding::Floor).",
  },
  {
    id: "ML-OZ-009",
    // Catches: raw fixed-point scale factor 1_000_000_000 (UD30x9 scale)
    pattern: /[*/]\s*1[_]?000[_]?000[_]?000(?!.*(?:UD30x9|SD29x9))/gm,
    severity: "high",
    ozSafePattern: "UD30x9 / SD29x9 fixed-point types",
    description:
      "Raw multiplication/division by 10^9 scale factor — use OZ UD30x9/SD29x9 fixed-point types.",
    recommendation:
      "Import openzeppelin_math::fixed_point::UD30x9 and operate on typed fixed-point values " +
      "rather than raw scaled integers.",
  },
  {
    id: "ML-OZ-010",
    // Catches: value * percent / 100  without mul_div rounding
    pattern: /\w+\s*\*\s*\w+\s*\/\s*100\b(?!.*mul_div)/gm,
    severity: "medium",
    ozSafePattern: "mul_div(value, percent, 100, rounding)",
    description:
      "Percentage calculation without explicit rounding via mul_div — can silently round down.",
    recommendation:
      "Use openzeppelin_math::u256::mul_div(value, percent, 100, Rounding::Floor) " +
      "to make rounding direction explicit.",
  },
];

// ──────────────────────────────────────────────────────────────
// Line-number helpers (duplicated from layer1 for self-containment)
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
  return lo + 1;
}

// ──────────────────────────────────────────────────────────────
// Public entry point
// ──────────────────────────────────────────────────────────────

/**
 * Run all 10 OZ benchmark rules against every module in the PackageContext.
 * ML-OZ-001 always runs first (Cetus-class).
 * Returns deduplicated, schema-valid Finding[] with confidence=0.95, source="layer2".
 */
export function runLayer2(ctx: PackageContext): Finding[] {
  const raw: Finding[] = [];

  for (const mod of ctx.modules) {
    const source = mod.source ?? mod.disassembly;
    if (!source) continue;

    const offsets = buildLineOffsets(source);

    for (const rule of OZ_RULES) {
      const re = new RegExp(rule.pattern.source, rule.pattern.flags.includes("g")
        ? rule.pattern.flags
        : rule.pattern.flags + "g"
      );
      re.lastIndex = 0;

      let match: RegExpExecArray | null;
      while ((match = re.exec(source)) !== null) {
        const start     = match.index;
        const end       = start + Math.max(match[0].length - 1, 0);
        const lineStart = charIndexToLine(offsets, start);
        const lineEnd   = charIndexToLine(offsets, end);

        const candidate = {
          rule_id:        rule.id,
          severity:       rule.severity,
          confidence:     0.95 as const,
          source:         "layer2" as const,
          module:         mod.name,
          line_start:     lineStart,
          line_end:       lineEnd,
          description:    rule.description,
          recommendation: rule.recommendation,
          category:       "integer_overflow" as const, // OZ rules are arithmetic-focused
        };

        const parsed = FindingSchema.safeParse(candidate);
        if (!parsed.success) {
          console.warn(
            `[layer2] Dropping invalid finding for rule ${rule.id}:`,
            parsed.error.issues.map((i) => i.message).join("; ")
          );
          if (match[0].length === 0) re.lastIndex++;
          continue;
        }

        raw.push(parsed.data);

        if (match[0].length === 0) re.lastIndex++;
      }
    }
  }

  // Deduplicate on (rule_id, module, line_start)
  const seen = new Set<string>();
  return raw.filter((f) => {
    const key = `${f.rule_id}:${f.module}:${f.line_start}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Exposed for F10 verification and engine tests. */
export { OZ_RULES };
export type { OzRule };
