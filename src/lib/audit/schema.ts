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

export const FindingSourceSchema = z.enum(["layer1", "layer2", "layer3", "layer4"]);
export type FindingSource = z.infer<typeof FindingSourceSchema>;

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
});
export type PackageContextSummary = z.infer<typeof PackageContextSummarySchema>;

// ──────────────────────────────────────────────────────────────
// Finding
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
});
export type Finding = z.infer<typeof FindingSchema>;

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
  findings: z.array(FindingSchema),
  severity_counts: SeverityCountsSchema,
  risk_grade: z.enum(["A", "B", "C", "D", "F"]),
  watermark: z.literal(WATERMARK),
  memory_context_used: z.boolean(),
  layer3_hits: z.number().int().nonnegative().optional(),
  layer4_used: z.boolean(),
  walrus_blob_id: z.string().optional(),
  sealed: z.boolean(),
  /** Whether the user opted into on-chain publishing via MVR. Gates mvr_name in public metadata. */
  publishOnChain: z.boolean().default(false),
});
export type AuditReport = z.infer<typeof AuditReportSchema>;
