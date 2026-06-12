// src/lib/memory/noop.ts
// NoopMemory — fallback stub when MEMWAL_ENABLED=false or MemWal is unreachable.
//
// HARD RULE: Business logic NEVER knows which AuditMemory implementation it got.
// This class satisfies the AuditMemory interface structurally.

import type { Finding } from "../audit/schema";
import type { AuditMemory, MemoryHit } from "./index";

/**
 * No-op memory implementation.
 * recall → always returns []
 * remember → does nothing
 * healthy → always returns true (the noop can't fail)
 */
export class NoopMemory implements AuditMemory {
  async recall(
    _query: string,
    _namespace: string,
  ): Promise<MemoryHit[]> {
    return [];
  }

  async remember(
    _finding: Finding,
    _namespace: string,
  ): Promise<void> {
    // intentional no-op
  }

  async healthy(): Promise<boolean> {
    return true;
  }
}
