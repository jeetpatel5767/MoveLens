// Zod schemas for audit engine output — Finding, AuditReport, PackageContextSummary.
// rule_id is validated against the live registry on every parse.
// HARD RULE: watermark must appear verbatim on every AuditReport.
// Layer 4 rule IDs use ML-XXX-L4-NNN format and must be pre-registered in rule-ids.ts.

import { z } from "zod";
import { VALID_RULE_IDS } from "./rule-ids";

// ──────────────────────────────────────────────────────────────
// Watermark — never change this string
// ──────────────────────────────────────────────────────────────

export const WATERMARK =
  "Automated pre-screen — not a substitute for a human audit." as const;

// ──────────────────────────────────────────────────────────────
// Primitive enums
// ──────────────────────────────────────────────────────────────

export const SeveritySchema = z.enum(["critical", "high", "medium", "low"]);
export type Severity = z.infer<typeof SeveritySchema>;

// Extended source enum — keeps legacy values for backwards compatibility
export const FindingSourceSchema = z.enum([
  "layer1",
  "layer2",
  "layer3",
  "layer4",
  "layer1_confirmed",
  "layer2_oz",
  "layer4_groq",
]);
export type FindingSource = z.infer<typeof FindingSourceSchema>;

// ──────────────────────────────────────────────────────────────
// Location — nested position used by the internal pipeline stages
// ──────────────────────────────────────────────────────────────

export const LocationSchema = z.object({
  module:     z.string(),
  function:   z.string().nullable(),
  line_start: z.number().int().nonnegative(),
  line_end:   z.number().int().nonnegative(),
});
export type Location = z.infer<typeof LocationSchema>;

// ──────────────────────────────────────────────────────────────
// PackageContextSummary — stripped-down package info for reports
// ──────────────────────────────────────────────────────────────

export const PackageContextSummarySchema = z.object({
  packageId: z.string().min(1),
  network: z.enum(["testnet", "mainnet"]),
  mvrName: z.string().nullable(),
  version: z.number().int().nonnegative(),
  moduleCount: z.number().int().nonnegative(),
  fetchedAt: z.string(),
  sourceRepo: z.string().nullable().optional(),
  inputType: z.string().optional(),
  fileCount: z.number().int().nonnegative().optional(),
  cappedAt: z.number().int().nonnegative().nullable().optional(),
});
export type PackageContextSummary = z.infer<typeof PackageContextSummarySchema>;

// ──────────────────────────────────────────────────────────────
// Finding (confirmed finding — affects score)
// rule_id validated: format AND registry membership.
// ──────────────────────────────────────────────────────────────

export const FindingSchema = z.object({
  rule_id: z
    .string()
    .regex(
      /^ML-[A-Z]+-(\d{3}|L4-\d{3})$/,
      "rule_id must match format ML-XXX-NNN or ML-XXX-L4-NNN"
    )
    .refine(
      (id) => VALID_RULE_IDS.has(id),
      (id) => ({ message: `rule_id "${id}" is not in the registry (rule-ids.ts)` })
    ),
  severity: SeveritySchema,
  confidence: z.number().min(0).max(1),
  source: FindingSourceSchema,
  module: z.string().min(1),
  line_start: z.number().int().nonnegative(),
  line_end: z.number().int().nonnegative(),
  description: z.string().min(1),
  recommendation: z.string().min(1),
  category: z.string().min(1),
  /** Raw code snippet that triggered this finding — used to embed in LanceDB corpus. */
  impacted_code: z.string().nullable().optional(),
  /** Vulnerable pattern (before fix) — shown in UI side-by-side diff for top categories. */
  patch_before: z.string().nullable().optional(),
  /** Fixed pattern (after fix) — shown in UI with "Copy fix" button. */
  patch_after: z.string().nullable().optional(),
  /** Human-readable explanation of the confidence score. */
  confidence_reason: z.string().optional(),
  /** Groq's exact reasoning for confirming this finding — shown in UI for transparency. */
  groq_reasoning: z.string().nullable().optional(),
});
export type Finding = z.infer<typeof FindingSchema>;

// ──────────────────────────────────────────────────────────────
// SUSPECT — Layer 1 matched a pattern. Not yet confirmed. Does not affect score.
//
// Carries BOTH the nested location (used by gate.ts) AND flat compatibility
// fields (module, line_start, line_end, confidence) so that FindingSchema
// can still parse suspects — important for test/f08-verify.ts.
// ──────────────────────────────────────────────────────────────

export const SuspectSchema = z.object({
  rule_id:        z.string(),
  severity:       SeveritySchema,
  title:          z.string(),
  description:    z.string(),
  // Nested location — used by gate.ts for Groq prompt building
  location:       LocationSchema,
  // Flat compatibility fields — mirrors location.* so FindingSchema can parse Suspects
  module:         z.string(),
  line_start:     z.number().int().nonnegative(),
  line_end:       z.number().int().nonnegative(),
  confidence:     z.literal(1.0),   // Layer 1 regex matches are always confidence=1.0
  impacted_code:  z.string().nullable(),
  recommendation: z.string(),
  category:       z.string(),
  source:         z.literal("layer1"),
  matched_text:   z.string(),  // what the regex matched — shown to Groq for confirmation
  context_lines:  z.string(),  // surrounding lines from raw source — full context for Groq
});
export type Suspect = z.infer<typeof SuspectSchema>;

// ──────────────────────────────────────────────────────────────
// DISMISSED SUSPECT — Groq said "no, this is fine"
// Shown in UI for transparency. NEVER affects score.
// ──────────────────────────────────────────────────────────────

export const DismissedSuspectSchema = z.object({
  rule_id:  z.string(),
  title:    z.string(),
  location: LocationSchema,
  reason:   z.string(),  // why Groq dismissed it (shown to user for trust)
});
export type DismissedSuspect = z.infer<typeof DismissedSuspectSchema>;

// ──────────────────────────────────────────────────────────────
// UNREVIEWED HINTS — suspects that couldn't be confirmed (Groq rate-limited/down)
// Shown in UI with disclaimer. NEVER affect score.
// ──────────────────────────────────────────────────────────────

export const UnreviewedHintSchema = SuspectSchema.extend({
  hint_reason: z.string().default("Groq confirmation unavailable — manual review recommended"),
});
export type UnreviewedHint = z.infer<typeof UnreviewedHintSchema>;

// ──────────────────────────────────────────────────────────────
// AUDIT SCORE — dimensional, confidence-weighted scoring
// Computed from CONFIRMED findings only.
// ──────────────────────────────────────────────────────────────

export const AuditScoreSchema = z.object({
  overall:   z.number().min(0).max(100),
  grade:     z.enum(["A", "B", "C", "D", "F"]),
  dimensions: z.object({
    accessControl:    z.number().min(0).max(100),
    arithmeticSafety: z.number().min(0).max(100),
    upgradeability:   z.number().min(0).max(100),
    codeQuality:      z.number().min(0).max(100),
    ozCompliance:     z.number().min(0).max(100),
  }),
  exploitability:      z.enum(["critical", "high", "medium", "low", "minimal"]),
  confirmed_count:     z.number().int().nonnegative(),
  dismissed_count:     z.number().int().nonnegative(),
  unreviewed_count:    z.number().int().nonnegative(),
  false_positive_rate: z.number().min(0).max(1),
});
export type AuditScore = z.infer<typeof AuditScoreSchema>;

// ──────────────────────────────────────────────────────────────
// AuditReport
// watermark is z.literal — any other string fails schema validation.
// ──────────────────────────────────────────────────────────────

export const SeverityCountsSchema = z.object({
  critical: z.number().int().nonnegative(),
  high: z.number().int().nonnegative(),
  medium: z.number().int().nonnegative(),
  low: z.number().int().nonnegative(),
});
export type SeverityCounts = z.infer<typeof SeverityCountsSchema>;

export const AuditReportSchema = z.object({
  report_id: z.string().uuid(),
  generated_at: z.string().datetime(),
  package: PackageContextSummarySchema,
  findings: z.array(FindingSchema),          // CONFIRMED only — affects score
  dismissed: z.array(DismissedSuspectSchema).default([]), // Groq said "no" — shown for transparency
  unreviewed: z.array(UnreviewedHintSchema).default([]),  // couldn't confirm — shown with disclaimer
  score: AuditScoreSchema.optional(),        // dimensional score from confirmed findings
  severity_counts: SeverityCountsSchema,
  risk_grade: z.enum(["A", "B", "C", "D", "F"]),
  watermark: z.literal(WATERMARK),
  memory_context_used: z.boolean(),
  layer3_hits: z.number().int().nonnegative().optional(),
  layer4_used: z.boolean(),
  walrus_blob_id: z.string().optional(),
  sealed: z.boolean(),
  publishOnChain: z.boolean().default(false),
});
export type AuditReport = z.infer<typeof AuditReportSchema>;
