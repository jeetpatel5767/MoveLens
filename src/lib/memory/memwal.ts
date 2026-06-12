// src/lib/memory/memwal.ts
// MemWal-backed AuditMemory — Phase 6 (F18).
//
// HARD RULE: Business logic NEVER calls this directly — only through src/lib/memory/index.ts.
//
// Requires env vars:
//   MEMWAL_PRIVATE_KEY  — Ed25519 delegate key hex (from generateDelegateKey())
//   MEMWAL_ACCOUNT_ID   — Sui mainnet MemWalAccount object ID (from createAccount())
//
// MemWal server: https://relayer.memwal.ai (mainnet, production)
// Package ID:    0xcee7a6fd8de52ce645c38332bde23d4a30fd9426bc4681409733dd50958a24c6

// Dynamic import — MemWal SDK is ESM-only; static import breaks tsx CJS context.
// We load it lazily inside each method to avoid top-level ESM resolution errors.
import type { AuditMemory, MemoryHit } from "./index";
import type { Finding } from "../audit/schema";
import { env } from "../env";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MemWalClient = any;

/**
 * MemWal-backed memory implementation.
 * Uses server-side TEE processing (embed + encrypt + Walrus upload).
 *
 * If the MemWal server is unreachable or credentials are invalid,
 * healthy() returns false and createMemory() falls back to NoopMemory.
 */
export class MemWalMemory implements AuditMemory {
  private client: MemWalClient | null = null;

  private async getClient(): Promise<MemWalClient> {
    if (this.client) return this.client;

    const privateKey = env.MEMWAL_PRIVATE_KEY;
    const accountId  = env.MEMWAL_ACCOUNT_ID;

    if (!privateKey || !accountId) {
      throw new Error(
        "MemWal credentials not configured: set MEMWAL_PRIVATE_KEY and MEMWAL_ACCOUNT_ID in .env",
      );
    }

    // Dynamic import — MemWal SDK is ESM-only.
    const { MemWal } = await import("@mysten-incubation/memwal");
    this.client = MemWal.create({ key: privateKey, accountId });
    return this.client;
  }

  async healthy(): Promise<boolean> {
    const privateKey = env.MEMWAL_PRIVATE_KEY;
    const accountId  = env.MEMWAL_ACCOUNT_ID;

    if (!privateKey || !accountId) {
      console.warn(
        "[memory/memwal] MEMWAL_PRIVATE_KEY or MEMWAL_ACCOUNT_ID not set — " +
        "falling back to noop memory. " +
        "To enable: create a MemWal account at https://relayer.memwal.ai and " +
        "set MEMWAL_PRIVATE_KEY + MEMWAL_ACCOUNT_ID in .env",
      );
      return false;
    }

    try {
      const client = await this.getClient();
      const result = await client.health();
      return result.status === "ok";
    } catch (err) {
      console.warn("[memory/memwal] health check failed:", err);
      return false;
    }
  }

  /**
   * Recall similar findings from MemWal via semantic search.
   *
   * Serializes the query into a text form, queries MemWal, and parses
   * returned text back into MemoryHit objects. Returns [] on any error.
   */
  async recall(query: string, namespace: string): Promise<MemoryHit[]> {
    try {
      const client = await this.getClient();
      const result = await client.recall({ query, limit: 5, namespace });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return result.results.map((r: any) => {
        let finding: Finding;
        try {
          finding = JSON.parse(r.text) as Finding;
        } catch {
          // If the text isn't valid JSON, make a minimal Finding placeholder.
          finding = {
            rule_id:        "ML-MEM-RECALL",
            description:    r.text,
            severity:       "low",
            confidence:     1 - r.distance,
            module:         "",
            line_start:     0,
            line_end:       0,
            recommendation: "",
            category:       "memory",
            layer:          "layer3",
          } as unknown as Finding;
        }
        return {
          finding,
          similarity: 1 - r.distance,
          namespace,
        };
      });
    } catch (err) {
      console.warn("[memory/memwal] recall failed (continuing without memory):", err);
      return [];
    }
  }

  /**
   * Persist a high-confidence finding to MemWal.
   *
   * Serializes the finding as JSON text and calls remember().
   * Fires-and-forgets — does NOT wait for the background job to complete
   * (MemWal's rememberAsync returns 202 Accepted immediately).
   * Any error is logged and swallowed.
   */
  async remember(finding: Finding, namespace: string): Promise<void> {
    try {
      const client = await this.getClient();
      const text   = JSON.stringify(finding);
      // remember() = fire-and-forget (202 Accepted).
      // Use rememberAsync rather than rememberAndWait to keep the engine fast.
      await client.remember(text, namespace);
      console.log(
        `[memory/memwal] remember ${finding.rule_id} → namespace "${namespace}"`,
      );
    } catch (err) {
      // Must never throw — just log and continue.
      console.warn("[memory/memwal] remember failed (continuing):", err);
    }
  }
}
