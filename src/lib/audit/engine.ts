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
import { runLayer4, reviewFindings } from "./layer4";
import { sanitizeForPatterns } from "./sanitize";
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
  // Existing (conservative — kept above rules.ts minimum for INT/OZ)
  "ML-INT": "high",   // INT min = medium (INT-004), keeping high (critical sector)
  "ML-OZ":  "high",   // Layer 2 only, no L1 rules — conservative floor
  "ML-ACC": "medium", // ACC min = medium (ACC-003, ACC-013)
  // New sectors — derived from minimum severity of Layer 1 rules in rules.ts
  "ML-ARI": "medium", // ARI min = medium (ARI-002..006)
  "ML-HOT": "high",   // HOT min = high (HOT-003, HOT-004)
  "ML-OWN": "medium", // OBJ min = medium (OBJ-009, OBJ-012, OBJ-013)
  "ML-UPG": "medium", // UPG min = medium (UPG-004)
  "ML-RAC": "low",    // RAC min = low (RAC-003)
  "ML-RET": "medium", // RET min = medium (RET-003)
  "ML-TOK": "medium", // TOK min = medium (TOK-005, TOK-007, TOK-008)
  "ML-WRP": "medium", // WRP min = medium (WRP-003)
  "ML-DOS": "low",    // DOS min = low (DOS-003)
  "ML-DEP": "medium", // EXT min = medium (EXT-002, EXT-003, EXT-004)
  "ML-LOG": "low",    // LOG min = low (LOG-016)
};

const sectorOf = (ruleId: string) => ruleId.split("-").slice(0, 2).join("-"); // "ML-INT"

function applySeverityFloor(finding: Finding): Finding {
  const sector = sectorOf(finding.rule_id);
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
  opts: { memoryContextUsed?: boolean; layer3Hits?: number; publishOnChain?: boolean } = {},
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
    publishOnChain:      opts.publishOnChain ?? false,
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
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
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
 *
 * Pass 1: exact-key dedup (rule_id + module + line_start).
 * Pass 2: sector-level dedup — drop Layer 4 heuristic-fallback findings that
 *   duplicate a Layer 1/2 finding in the same sector, same module, and within
 *   ±2 lines. Only removed when the Layer 4 finding has no LanceDB corpus match
 *   (indicated by "Similar to known vulnerability" in the description).
 */
export function mergeAndDedupe(findings: Finding[]): Finding[] {
  // Pass 1 — exact dedup
  const best = new Map<string, Finding>();
  for (const f of findings) {
    const floored = applySeverityFloor(f);
    const key = `${floored.rule_id}:${floored.module}:${floored.line_start}`;
    const existing = best.get(key);
    if (!existing || floored.confidence > existing.confidence) {
      best.set(key, floored);
    }
  }

  // Pass 1b — same rule_id + same module cap: keep max 2 per (rule_id, module)
  // Prevents Layer 1 rules like ML-ACC-001 from firing on every public function.
  // Keeps the 2 highest-confidence instances to preserve positional context.
  const ruleModuleGroups = new Map<string, Finding[]>();
  for (const f of best.values()) {
    const groupKey = `${f.rule_id}:${f.module}`;
    const group = ruleModuleGroups.get(groupKey) ?? [];
    group.push(f);
    ruleModuleGroups.set(groupKey, group);
  }
  const capped = new Map<string, Finding>();
  for (const group of ruleModuleGroups.values()) {
    const sorted = group.sort((a, b) => b.confidence - a.confidence).slice(0, 2);
    for (const f of sorted) {
      capped.set(`${f.rule_id}:${f.module}:${f.line_start}`, f);
    }
  }
  // Replace best with capped
  best.clear();
  for (const [k, v] of capped) best.set(k, v);

  // Pass 2 — sector-level cross-layer dedup
  const deduped = [...best.values()];
  const isL4 = (f: Finding) => f.rule_id.includes("-L4-");
  const l1 = deduped.filter(f => !isL4(f));
  const l4 = deduped.filter(f => isL4(f));

  const toRemove = new Set<string>();
  for (const f4 of l4) {
    const hasCorpusMatch = f4.description.includes("Similar to known vulnerability");
    if (hasCorpusMatch) continue; // LanceDB match adds unique context — keep it
    const sector4 = sectorOf(f4.rule_id);
    for (const f1 of l1) {
      if (f1.module !== f4.module) continue;
      if (sectorOf(f1.rule_id) !== sector4) continue;
      if (Math.abs(f1.line_start - f4.line_start) > 2) continue;
      console.log(`[engine] dedup L4 heuristic ${f4.rule_id}@${f4.module}:${f4.line_start} (L1 has ${f1.rule_id}@${f1.line_start})`);
      toRemove.add(`${f4.rule_id}:${f4.module}:${f4.line_start}`);
      break;
    }
  }
  return toRemove.size === 0
    ? deduped
    : deduped.filter(f => !toRemove.has(`${f.rule_id}:${f.module}:${f.line_start}`));
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
  // Use the first module's sanitized source (first 500 chars) as the recall query.
  // Sanitizing before recall avoids embedding comment noise into the similarity search.
  let memHits: MemoryHit[] = [];
  try {
    const firstModule = ctx.modules[0];
    const rawSrc = firstModule?.source ?? firstModule?.disassembly ?? "";
    const recallQuery = sanitizeForPatterns(rawSrc, false).slice(0, 500);
    if (recallQuery.trim()) {
      memHits = await memory.recall(recallQuery, "movelens/all");
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
  const groqAvailable   = Boolean(env.GROQ_API_KEY);
  const sidecarReachable = await sidecarHealthy();

  if (groqAvailable || sidecarReachable) {
    try {
      l4 = await Promise.race([
        runLayer4(ctx, memHits),
        new Promise<Finding[]>((_, reject) =>
          setTimeout(() => reject(new Error("Layer 4 timeout (90s)")), 90_000)
        ),
      ]);
      layersRun.push("layer4");
    } catch (err) {
      console.warn("[engine] Layer 4 threw — continuing with Layers 1–2 only:", err);
    }
  } else {
    console.warn("[engine] Layer 4 unavailable (no Groq key, sidecar unreachable) — Layers 1–2 only");
  }
  l4Ms = Date.now() - l4Start;

  // ── Merge, deduplicate, sort ─────────────────────────────────
  const merged = mergeAndDedupe([...l1, ...l2, ...l4]);
  const sorted = sortFindings(merged);

  // ── Review pass: Groq removes cross-layer duplicates + false positives ──
  console.log(`[engine] Running Groq review pass on ${sorted.length} finding(s)...`);
  const findings = await reviewFindings(sorted);

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
