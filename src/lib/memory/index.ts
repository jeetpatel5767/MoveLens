// src/lib/memory/index.ts
// AuditMemory abstraction layer — the ONLY entry point for memory in business logic.
//
// HARD RULES:
//   - Business logic NEVER imports from memwal.ts directly.
//   - Business logic NEVER knows which implementation is active.
//   - When MEMWAL_ENABLED=false, createMemory() returns NoopMemory silently.
//   - When MemWal is unhealthy, createMemory() falls back to NoopMemory with a warning.

import type { Finding } from "../audit/schema";
import { env } from "../env";
import { NoopMemory } from "./noop";

// ── Public types ──────────────────────────────────────────────────────────────

/**
 * A single memory hit returned by recall().
 * Contains the original finding, a similarity score [0,1], and its namespace.
 */
export interface MemoryHit {
  finding: Finding;
  similarity: number;
  namespace: string;
}

/**
 * Abstraction over MemWal (or noop).
 * Phase 6 (F18) adds the real MemWalMemory implementation.
 */
export interface AuditMemory {
  /**
   * Semantic search over past findings.
   * Returns up to 5 similar findings from the given namespace.
   * Always returns [] on failure — must never throw.
   */
  recall(query: string, namespace: string): Promise<MemoryHit[]>;

  /**
   * Persist a finding for future recall.
   * High-confidence findings (>= 0.8) are persisted.
   * Must never throw — failure is logged and swallowed.
   */
  remember(finding: Finding, namespace: string): Promise<void>;

  /**
   * Check if the underlying memory store is reachable.
   * NoopMemory always returns true.
   */
  healthy(): Promise<boolean>;
}

// ── Re-exports ────────────────────────────────────────────────────────────────

export { NoopMemory };

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * Create the best available AuditMemory for this process.
 *
 * Priority:
 *   1. LanceDB memory (backed by Python sidecar /recall) — Layer 3 real implementation
 *   2. If MEMWAL_ENABLED=true and MemWal is healthy → MemWalMemory (Phase 6 / F18)
 *   3. Otherwise → NoopMemory (with a warning)
 *
 * The caller (API route or test) should call this once and pass the result into
 * runAudit(). The AuditReport's `memory_context_used` field reflects whether
 * recall returned any hits.
 */
export async function createMemory(): Promise<AuditMemory> {
  // Priority 1: LanceDB memory via sidecar (Layer 3 real)
  try {
    const { LanceDBMemory } = await import("./lancedb-memory");
    const mem = new LanceDBMemory();
    if (await mem.healthy()) {
      console.log("[memory] Using LanceDB memory (Layer 3 active)");
      return mem;
    }
    console.warn("[memory] LanceDB sidecar unhealthy — trying next option");
  } catch (err) {
    console.warn(`[memory] LanceDB memory init failed (${err}) — trying next option`);
  }

  // Priority 2: MemWal (Phase 6 / F18 — requires funded mainnet account)
  if (env.MEMWAL_ENABLED) {
    try {
      const { MemWalMemory } = await import("./memwal");
      const memwal = new MemWalMemory();
      if (await memwal.healthy()) return memwal;
      console.warn("[memory] MemWal healthy() returned false — falling back to noop memory");
    } catch (err) {
      console.warn(`[memory] MemWal init failed (${err}) — falling back to noop memory`);
    }
  }

  console.warn("[memory] Using noop memory (memory_context_used will be false)");
  return new NoopMemory();
}
