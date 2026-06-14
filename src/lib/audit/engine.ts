// Audit engine — orchestrates Layers 1, 2, 3, and (optionally) 4.
// Layer 3 uses LanceDB-backed semantic recall via the Python sidecar.
//
// HARD RULES:
//   - Layer 4 failure MUST NEVER kill the audit — log warning and continue.
//   - Layers 1+2 must complete in < 5 seconds on any fixture.
//   - Deduplication: same (rule_id, module, line_start) → keep HIGHEST confidence.
//   - Sort order: ML-OZ-001 / ML-INT-001 absolute first, then severity desc, then confidence desc.
//   - NEVER call the Layer 4 sidecar except through this file (and eventually layer4.ts).
//   - NEVER use JSON-RPC anywhere in this file.

import { runLayer1 } from "./layer1";
import { runLayer2 } from "./layer2";
import { runLayer4 } from "./layer4";
import {
  AuditReportSchema,
  WATERMARK,
} from "./schema";
import type { Finding, AuditReport, SeverityCounts } from "./schema";
import type { PackageContext } from "../sui/queries";
import { env } from "../env";
import type { AuditMemory, MemoryHit } from "../memory/index";
import { NoopMemory } from "../memory/noop";

// Re-export so callers can use the type from either location.
export type { AuditMemory };

// ──────────────────────────────────────────────────────────────
// Severity floor — prevents Layer 4 from silently downgrading a
// Layer 1 / Layer 2 finding for the same vuln class.
// ──────────────────────────────────────────────────────────────

import type { Severity } from "./schema";

const SEVERITY_RANK: Record<Severity, number> = {
  critical: 4,
  high:     3,
  medium:   2,
  low:      1,
};

const CATEGORY_SEVERITY_FLOOR: Record<string, Severity> = {
  "ML-INT": "high",   // integer overflow / bitwise — never below high
  "ML-OZ":  "high",   // OZ math deviations — never below high
  "ML-ACC": "medium", // access control — never below medium
};

function applySeverityFloor(finding: Finding): Finding {
  const sector = finding.rule_id.split("-").slice(0, 2).join("-"); // e.g. "ML-INT"
  const floor = CATEGORY_SEVERITY_FLOOR[sector];
  if (floor && SEVERITY_RANK[finding.severity] < SEVERITY_RANK[floor]) {
    return { ...finding, severity: floor };
  }
  return finding;
}

// Default memory — Phase 6 (F17/F18) wires the real MemWalMemory through createMemory().
// Tests and the API route can pass a specific memory instance; this default is noop.
const NOOP_MEMORY: AuditMemory = new NoopMemory();

// ──────────────────────────────────────────────────────────────
// Engine result type
// ──────────────────────────────────────────────────────────────

export interface EngineResult {
  findings:    Finding[];
  layersRun:   string[];
  durationMs:  { layer1: number; layer2: number; layer4: number; total: number };
  layer3Hits:  number;
}

// ──────────────────────────────────────────────────────────────
// Report assembly (Phase 3 / F11)
// ──────────────────────────────────────────────────────────────

/**
 * Count findings by severity.
 */
export function computeSeverityCounts(findings: Finding[]): SeverityCounts {
  return {
    critical: findings.filter((f) => f.severity === "critical").length,
    high:     findings.filter((f) => f.severity === "high").length,
    medium:   findings.filter((f) => f.severity === "medium").length,
    low:      findings.filter((f) => f.severity === "low").length,
  };
}

/**
 * Compute A–F risk grade from severity counts.
 *
 * Mapping (documented in IMPLEMENTATION.md Task 3.1):
 *   F — any critical finding
 *   D — ≥ 2 high findings
 *   C — exactly 1 high finding
 *   B — medium findings only (no high/critical)
 *   A — only low / info findings (or none)
 */
export function computeRiskGrade(
  counts: SeverityCounts
): "A" | "B" | "C" | "D" | "F" {
  if (counts.critical > 0) return "F";
  if (counts.high >= 2)    return "D";
  if (counts.high === 1)   return "C";
  if (counts.medium > 0)   return "B";
  return "A";
}

/**
 * Produce a complete, schema-validated AuditReport from a PackageContext and
 * the raw EngineResult.  Findings are expected to be already sorted (runAudit
 * returns them sorted); this function does not re-sort.
 *
 * HARD RULE: watermark is hardcoded here — never configurable.
 */
export function assembleReport(
  ctx: PackageContext,
  result: EngineResult,
  opts: { memoryContextUsed?: boolean; layer3Hits?: number } = {},
): AuditReport {
  const severity_counts = computeSeverityCounts(result.findings);

  return AuditReportSchema.parse({
    report_id:   crypto.randomUUID(),
    generated_at: new Date().toISOString(),
    package: {
      packageId:   ctx.packageId,
      network:     ctx.network,
      mvrName:     ctx.mvrName,
      version:     ctx.version,
      moduleCount: ctx.modules.length,
      fetchedAt:   ctx.fetchedAt,
    },
    findings:            result.findings,
    severity_counts,
    risk_grade:          computeRiskGrade(severity_counts),
    watermark:           WATERMARK,
    memory_context_used: opts.memoryContextUsed ?? false,
    layer3_hits:         opts.layer3Hits ?? 0,
    layer4_used:         result.layersRun.includes("layer4"),
    sealed:              false,
  });
}

// ──────────────────────────────────────────────────────────────
// Sidecar health check (Layer 4)
// ──────────────────────────────────────────────────────────────

/**
 * Returns true only if the Layer 4 Python sidecar is reachable on /health.
 * Any error (connection refused, timeout, wrong response) returns false.
 * This must NEVER throw.
 */
export async function sidecarHealthy(): Promise<boolean> {
  try {
    const url = `${env.LAYER4_SIDECAR_URL}/health`;
    const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

// ──────────────────────────────────────────────────────────────
// Deduplication: same (rule_id, module, line_start) → highest confidence
// ──────────────────────────────────────────────────────────────

/**
 * Merge findings from multiple layers, keeping the highest-confidence instance
 * when the same (rule_id, module, line_start) appears more than once.
 */
export function mergeAndDedupe(findings: Finding[]): Finding[] {
  const best = new Map<string, Finding>();
  for (const f of findings) {
    // Apply severity floor before dedup so the floor wins regardless of which
    // layer emitted the finding.
    const floored = applySeverityFloor(f);
    const key = `${floored.rule_id}:${floored.module}:${floored.line_start}`;
    const existing = best.get(key);
    if (!existing || floored.confidence > existing.confidence) {
      best.set(key, floored);
    }
  }
  return [...best.values()];
}

// ──────────────────────────────────────────────────────────────
// Sort order
// ──────────────────────────────────────────────────────────────

const SEVERITY_ORDER: Record<string, number> = {
  critical: 0,
  high:     1,
  medium:   2,
  low:      3,
};

const CETUS_IDS = new Set(["ML-INT-001", "ML-OZ-001"]);

/**
 * Sort findings:
 *   1. Cetus-class (ML-INT-001 / ML-OZ-001) absolute top
 *   2. Severity descending (critical → low)
 *   3. Confidence descending within severity
 */
export function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort((a, b) => {
    const aCetus = CETUS_IDS.has(a.rule_id) ? 0 : 1;
    const bCetus = CETUS_IDS.has(b.rule_id) ? 0 : 1;
    if (aCetus !== bCetus) return aCetus - bCetus;

    const sevDiff = (SEVERITY_ORDER[a.severity] ?? 99) - (SEVERITY_ORDER[b.severity] ?? 99);
    if (sevDiff !== 0) return sevDiff;

    return b.confidence - a.confidence;
  });
}

// ──────────────────────────────────────────────────────────────
// Main entry point
// ──────────────────────────────────────────────────────────────

/**
 * Run the full audit pipeline:
 *   Layer 1 (deterministic REGEX, confidence=1.0)
 *   Layer 2 (OZ benchmark, confidence=0.95)
 *   Layer 4 (model ensemble — skipped if sidecar unreachable)
 *
 * Returns merged, deduplicated, sorted findings plus timing/layer metadata.
 * Phase 3 (F11) will wrap this in a full AuditReport.
 */
export async function runAudit(
  ctx: PackageContext,
  memory: AuditMemory = NOOP_MEMORY,
): Promise<EngineResult> {
  const totalStart = Date.now();
  const layersRun: string[] = [];

  // ── Layer 1 ─────────────────────────────────────────────────
  const l1Start = Date.now();
  const l1 = runLayer1(ctx);
  const l1Ms = Date.now() - l1Start;
  layersRun.push("layer1");

  // ── Layer 2 ─────────────────────────────────────────────────
  const l2Start = Date.now();
  const l2 = runLayer2(ctx);
  const l2Ms = Date.now() - l2Start;
  layersRun.push("layer2");

  // ── Layer 3: LanceDB semantic recall ─────────────────────────
  // Concatenate module source/disassembly and query the corpus for similar patterns.
  let memHits: MemoryHit[] = [];
  try {
    const codeForRecall = ctx.modules
      .map((m) => (m.source ?? m.disassembly ?? "").slice(0, 600))
      .join("\n---\n")
      .slice(0, 2000);
    if (codeForRecall.trim()) {
      memHits = await memory.recall(codeForRecall, `movelens/${ctx.packageId}`);
      if (memHits.length > 0) {
        layersRun.push("layer3");
        console.log(`[engine] Layer 3 recall: ${memHits.length} hit(s) from corpus`);
      }
    }
  } catch (err) {
    console.warn("[engine] Layer 3 recall failed (continuing without memory context):", err);
  }

  // ── Layer 4 (optional — never kills the audit) ───────────────
  let l4: Finding[] = [];
  let l4Ms = 0;
  const l4Start = Date.now();
  if (await sidecarHealthy()) {
    try {
      l4 = await runLayer4(ctx, memHits);
      layersRun.push("layer4");
    } catch (err) {
      console.warn("[engine] Layer 4 threw — continuing with Layers 1–2 only:", err);
    }
  } else {
    console.warn("[engine] Layer 4 sidecar unreachable — continuing with Layers 1–2 only");
  }
  l4Ms = Date.now() - l4Start;

  // ── Merge, deduplicate, sort ─────────────────────────────────
  const merged  = mergeAndDedupe([...l1, ...l2, ...l4]);
  const findings = sortFindings(merged);

  // ── Layer 3 remember: persist high-confidence findings for future recall ─
  for (const f of findings.filter((f) => f.confidence >= 0.8)) {
    await memory.remember(f, `movelens/${f.category}`);
  }

  return {
    findings,
    layersRun,
    durationMs: {
      layer1: l1Ms,
      layer2: l2Ms,
      layer4: l4Ms,
      total:  Date.now() - totalStart,
    },
    layer3Hits: memHits.length,
  };
}
