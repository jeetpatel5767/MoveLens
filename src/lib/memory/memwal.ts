// src/lib/memory/memwal.ts
// MemWal implementation — Phase 6 (F18).
//
// This stub is imported dynamically by createMemory() when MEMWAL_ENABLED=true.
// The real implementation lands in F18.
//
// HARD RULE: Business logic NEVER calls this directly — only through index.ts.

import type { Finding } from "../audit/schema";
import type { AuditMemory, MemoryHit } from "./index";

/**
 * MemWal-backed memory implementation (placeholder — F18 provides the real one).
 * healthy() returns false so createMemory() falls back to NoopMemory until F18.
 */
export class MemWalMemory implements AuditMemory {
  async recall(
    _query: string,
    _namespace: string,
  ): Promise<MemoryHit[]> {
    // F18: call MemWal recall API
    return [];
  }

  async remember(
    _finding: Finding,
    _namespace: string,
  ): Promise<void> {
    // F18: call MemWal remember API
  }

  async healthy(): Promise<boolean> {
    // Returns false until F18 wires the real MemWal endpoint.
    // createMemory() will fall back to NoopMemory.
    return false;
  }
}
