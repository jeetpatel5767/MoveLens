// Audit engine — orchestrates Layers 1, 2, and (optionally) 4.
// Layer 3 (MemWal) hooks are wired here but use a noop stub until Phase 6.
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
import type { Finding } from "./schema";
import type { PackageContext } from "../sui/queries";
import { env } from "../env";

// ──────────────────────────────────────────────────────────────
// Minimal AuditMemory stub (Phase 6 will replace with MemWal)
// ──────────────────────────────────────────────────────────────

export interface AuditMemory {
  recall: (query: string, namespace: string) => Promise<Finding[]>;
  remember: (finding: Finding, namespace: string) => Promise<void>;
}

const NOOP_MEMORY: AuditMemory = {
  recall:   async () => [],
  remember: async () => { /* noop */ },
};

// ──────────────────────────────────────────────────────────────
// Engine result type (Phase 3 will add full AuditReport assembly)
// ──────────────────────────────────────────────────────────────

export interface EngineResult {
  findings:   Finding[];
  layersRun:  string[];
  durationMs: { layer1: number; layer2: number; layer4: number; total: number };
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
    const key = `${f.rule_id}:${f.module}:${f.line_start}`;
    const existing = best.get(key);
    if (!existing || f.confidence > existing.confidence) {
      best.set(key, f);
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

  // ── Layer 3 recall stub (noop until Phase 6) ─────────────────
  await memory.recall("", "movelens/all");

  // ── Layer 4 (optional — never kills the audit) ───────────────
  let l4: Finding[] = [];
  let l4Ms = 0;
  const l4Start = Date.now();
  if (await sidecarHealthy()) {
    try {
      // layer4.ts is deferred until F25–F28 (Phases 1–5 must be green first).
      // When implemented, call: l4 = await runLayer4(ctx, memoryHits);
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

  // ── Layer 3 remember stub ────────────────────────────────────
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
  };
}
