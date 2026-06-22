// Audit engine — NEW FLOW: Layer 1 → suspects, Groq gate confirms/dismisses,
// Layer 2 bypasses gate directly. Only CONFIRMED findings affect the score.
//
// HARD RULES:
//   - Layer 4 gate failure MUST NEVER kill the audit — suspects fall to unreviewed.
//   - Layers 1+2 must complete in < 5 seconds on any fixture.
//   - Sort order: ML-OZ-001 / ML-INT-001 absolute first, then severity desc, then confidence desc.
//   - NEVER call paid AI APIs — Groq free tier only, through gate.ts.
//   - NEVER use JSON-RPC anywhere in this file.

import { runLayer1 } from "./layer1";
import { runLayer2 } from "./layer2";
import { runConfirmationGate } from "./gate";
import type { GateResult } from "./gate";
import { sanitizeForPatterns } from "./sanitize";
import {
  AuditReportSchema,
  WATERMARK,
  AuditScoreSchema,
} from "./schema";
import type {
  Finding,
  AuditReport,
  SeverityCounts,
  AuditScore,
  DismissedSuspect,
  UnreviewedHint,
} from "./schema";
import type { PackageContext } from "../sui/queries";
import { env } from "../env";
import type { AuditMemory, MemoryHit } from "../memory/index";
import { NoopMemory } from "../memory/noop";

// Re-export so callers can use the type from either location.
export type { AuditMemory };

// Default memory — Phase 6 (F17/F18) wires the real MemWalMemory through createMemory().
const NOOP_MEMORY: AuditMemory = new NoopMemory();

// ──────────────────────────────────────────────────────────────
// Engine result type — now includes dismissed, unreviewed, score
// ──────────────────────────────────────────────────────────────

export interface EngineResult {
  findings:    Finding[];          // confirmed only
  dismissed:   DismissedSuspect[];
  unreviewed:  UnreviewedHint[];
  score:       AuditScore;
  layersRun:   string[];
  durationMs:  { layer1: number; layer2: number; layer4: number; total: number };
  layer3Hits:  number;
}

// ──────────────────────────────────────────────────────────────
// Severity rank
// ──────────────────────────────────────────────────────────────

import type { Severity } from "./schema";

const SEVERITY_RANK: Record<Severity, number> = {
  critical: 4,
  high:     3,
  medium:   2,
  low:      1,
};

// ──────────────────────────────────────────────────────────────
// Sort order
// ──────────────────────────────────────────────────────────────

const SEVERITY_ORDER: Record<string, number> = { critical:0, high:1, medium:2, low:3 };
const CETUS_IDS = new Set(["ML-INT-001", "ML-OZ-001"]);

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
// Merge findings — deduplicate on (rule_id, module, line_start)
// keeping highest confidence when same key appears from multiple sources.
// ──────────────────────────────────────────────────────────────

export function mergeFindings(findings: Finding[]): Finding[] {
  const best = new Map<string, Finding>();
  for (const f of findings) {
    const key = `${f.rule_id}:${f.module}:${f.line_start}`;
    const existing = best.get(key);
    if (!existing || f.confidence > existing.confidence) {
      best.set(key, f);
    }
  }
  return [...best.values()];
}

// ──────────────────────────────────────────────────────────────
// Severity counts (from confirmed findings)
// ──────────────────────────────────────────────────────────────

export function computeSeverityCounts(findings: Finding[]): SeverityCounts {
  return {
    critical: findings.filter(f => f.severity === "critical").length,
    high:     findings.filter(f => f.severity === "high").length,
    medium:   findings.filter(f => f.severity === "medium").length,
    low:      findings.filter(f => f.severity === "low").length,
  };
}

// ──────────────────────────────────────────────────────────────
// Risk grade (from score.grade)
// ──────────────────────────────────────────────────────────────

export function computeRiskGrade(counts: SeverityCounts): "A"|"B"|"C"|"D"|"F" {
  if (counts.critical > 0) return "F";
  if (counts.high >= 2)    return "D";
  if (counts.high === 1)   return "C";
  if (counts.medium > 0)   return "B";
  return "A";
}

// ──────────────────────────────────────────────────────────────
// Scoring — dimensional, confidence-weighted, confirmed-only
// ──────────────────────────────────────────────────────────────

const SECTOR_TO_DIM: Record<string, keyof AuditScore["dimensions"]> = {
  "ML-ACC": "accessControl",
  "ML-INT": "arithmeticSafety",
  "ML-ARI": "arithmeticSafety",
  "ML-OZ":  "arithmeticSafety",
  "ML-UPG": "upgradeability",
  "ML-HOT": "codeQuality",
  "ML-OWN": "codeQuality",
  "ML-WRP": "codeQuality",
  "ML-RET": "codeQuality",
  "ML-TOK": "codeQuality",
  "ML-RAC": "codeQuality",
  "ML-DOS": "codeQuality",
  "ML-DEP": "codeQuality",
  "ML-LOG": "codeQuality",
};

function sectorOf(ruleId: string): string {
  return ruleId.split("-").slice(0, 2).join("-");
}

function deduction(severity: string, confidence: number): number {
  const base = ({ critical:50, high:20, medium:8, low:2, info:0 } as Record<string,number>)[severity] ?? 0;
  return Math.round(base * confidence); // confidence-weighted
}

export function computeScore(findings: Finding[], gate: GateResult): AuditScore {
  const dims = {
    accessControl:    100,
    arithmeticSafety: 100,
    upgradeability:   100,
    codeQuality:      100,
    ozCompliance:     100,
  };

  for (const f of findings) {
    const sector = sectorOf(f.rule_id);
    const dim    = SECTOR_TO_DIM[sector] ?? "codeQuality";
    const d      = deduction(f.severity, f.confidence);
    dims[dim]    = Math.max(0, dims[dim] - d);
    // OZ findings also hit ozCompliance directly
    if (sector === "ML-OZ") {
      dims.ozCompliance = Math.max(0, dims.ozCompliance - d);
    }
  }

  const overall = Math.round(
    dims.accessControl    * 0.30 +
    dims.arithmeticSafety * 0.25 +
    dims.upgradeability   * 0.15 +
    dims.codeQuality      * 0.15 +
    dims.ozCompliance     * 0.15,
  );

  const grade: "A"|"B"|"C"|"D"|"F" =
    overall >= 90 ? "A" :
    overall >= 75 ? "B" :
    overall >= 60 ? "C" :
    overall >= 40 ? "D" : "F";

  const hasCriticalHighConf = findings.some(f => f.severity === "critical" && f.confidence >= 0.85);
  const hasCriticalLowConf  = findings.some(f => f.severity === "critical" && f.confidence <  0.85);
  const hasHigh             = findings.some(f => f.severity === "high");
  const hasMedium           = findings.some(f => f.severity === "medium");

  const exploitability =
    hasCriticalHighConf ? "critical" :
    hasCriticalLowConf  ? "high"     :
    hasHigh             ? "medium"   :
    hasMedium           ? "low"      : "minimal";

  const totalReviewed    = gate.confirmed.length + gate.dismissed.length;
  const falsePositiveRate = totalReviewed > 0
    ? Math.round((gate.dismissed.length / totalReviewed) * 100) / 100
    : 0;

  // confirmed_count = confirmed Layer 1 + Layer 2 (which bypass the gate)
  const layer2Count = findings.filter(f => f.source === "layer2").length;

  return AuditScoreSchema.parse({
    overall,
    grade,
    dimensions: dims,
    exploitability,
    confirmed_count:     gate.confirmed.length + layer2Count,
    dismissed_count:     gate.dismissed.length,
    unreviewed_count:    gate.unreviewed.length,
    false_positive_rate: falsePositiveRate,
  });
}

// ──────────────────────────────────────────────────────────────
// Sidecar health check (kept for backward compat; no longer used in main flow)
// ──────────────────────────────────────────────────────────────

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
// Memory context builder
// ──────────────────────────────────────────────────────────────

function buildMemoryContext(hits: MemoryHit[]): string {
  if (hits.length === 0) return "";
  return hits.slice(0, 2).map(hit => {
    const safeRuleId = hit.finding.rule_id.replace(/[^a-zA-Z0-9\-_]/g, "").slice(0, 32);
    const safeScore  = hit.similarity.toFixed(2);
    return `KNOWN SIMILAR PATTERN: rule=${safeRuleId} (similarity ${safeScore})`;
  }).join("\n");
}

// ──────────────────────────────────────────────────────────────
// Report assembly
// ──────────────────────────────────────────────────────────────

export function assembleReport(
  ctx:    PackageContext,
  result: EngineResult,
  opts:   { memoryContextUsed?: boolean; layer3Hits?: number; publishOnChain?: boolean } = {},
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
      sourceRepo:  ctx.sourceRepo,
      inputType:   ctx.inputType,
      fileCount:   ctx.fileCount,
      cappedAt:    ctx.cappedAt,
    },
    findings:            result.findings,       // confirmed only
    dismissed:           result.dismissed,
    unreviewed:          result.unreviewed,
    score:               result.score,
    severity_counts,
    risk_grade:          result.score.grade,    // from dimensional score, not severity counts
    watermark:           WATERMARK,
    memory_context_used: opts.memoryContextUsed ?? false,
    layer3_hits:         opts.layer3Hits ?? 0,
    layer4_used:         result.layersRun.some(l => l.includes("layer4")),
    sealed:              false,
    publishOnChain:      opts.publishOnChain ?? false,
  });
}

// ──────────────────────────────────────────────────────────────
// Main entry point — NEW FLOW
// ──────────────────────────────────────────────────────────────

/**
 * Run the full audit pipeline:
 *   Layer 3: recall (before anything — enriches gate prompts)
 *   Layer 1: produce SUSPECTS (not findings)
 *   Layer 2: deterministic OZ checks → CONFIRMED FINDINGS (bypass gate)
 *   Gate   : Groq confirms or dismisses each Layer 1 suspect
 *   Merge  : confirmed Layer 1 + Layer 2 findings → score
 *
 * Only CONFIRMED findings affect the score.
 * Dismissed suspects are shown in UI for transparency but never scored.
 * Unreviewed hints (Groq unavailable) shown with disclaimer, never scored.
 */
export async function runAudit(
  ctx:    PackageContext,
  memory: AuditMemory = NOOP_MEMORY,
): Promise<EngineResult> {
  const totalStart = Date.now();
  const layersRun: string[] = [];

  // ── Layer 3: recall (before anything — enriches the gate prompt) ─────────
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
  const memoryContext = buildMemoryContext(memHits);

  // ── Layer 1: produce SUSPECTS ────────────────────────────────────────────
  const l1Start   = Date.now();
  const suspects  = runLayer1(ctx);
  const l1Ms      = Date.now() - l1Start;
  layersRun.push("layer1");
  console.log(`[engine] Layer 1: ${suspects.length} suspect(s) → sending to confirmation gate`);

  // ── Layer 2: OZ checks — bypass the gate, direct to confirmed findings ───
  const l2Start    = Date.now();
  const ozFindings = runLayer2(ctx);
  const l2Ms       = Date.now() - l2Start;
  layersRun.push("layer2");
  console.log(`[engine] Layer 2: ${ozFindings.length} OZ finding(s) (gate bypassed)`);

  // ── Confirmation Gate (Groq) ─────────────────────────────────────────────
  let gateResult: GateResult = { confirmed: [], dismissed: [], unreviewed: [] };
  const l4Start = Date.now();

  if (env.GROQ_API_KEY) {
    try {
      gateResult = await runConfirmationGate(suspects, memoryContext);
      layersRun.push("layer4_gate");
    } catch (err) {
      // Gate failure → all suspects become unreviewed
      console.warn("[engine] Gate threw — all suspects fall to unreviewed:", err);
      gateResult.unreviewed = suspects.map(s => ({
        ...s,
        hint_reason: "Gate error — manual review recommended",
      }));
    }
  } else {
    // No Groq key → ALL suspects become unreviewed hints (never findings)
    console.warn("[engine] No GROQ_API_KEY — all Layer 1 suspects are unreviewed hints");
    gateResult.unreviewed = suspects.map(s => ({
      ...s,
      hint_reason: "Groq API key not configured — configure GROQ_API_KEY for AI confirmation",
    }));
  }

  const l4Ms = Date.now() - l4Start;

  // ── Merge: confirmed Layer 1 + Layer 2 OZ findings ───────────────────────
  const allFindings = sortFindings(mergeFindings([
    ...gateResult.confirmed,
    ...ozFindings,
  ]));

  // ── Score (based ONLY on confirmed findings) ──────────────────────────────
  const score = computeScore(allFindings, gateResult);

  // ── Layer 3 remember: persist high-confidence confirmed findings ──────────
  const toRemember = allFindings.filter(
    f => f.source === "layer2" || (f.source === "layer1_confirmed" && f.confidence >= 0.85)
  );
  for (const f of toRemember) {
    try {
      await memory.remember(f, `movelens/${f.category}`);
    } catch {
      // swallow — never let memory write kill the audit
    }
  }

  console.log(
    `[engine] Done — ${allFindings.length} confirmed finding(s), score=${score.overall} (${score.grade}), ` +
    `${gateResult.dismissed.length} dismissed, ${gateResult.unreviewed.length} unreviewed`
  );

  return {
    findings:   allFindings,
    dismissed:  gateResult.dismissed,
    unreviewed: gateResult.unreviewed,
    score,
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
