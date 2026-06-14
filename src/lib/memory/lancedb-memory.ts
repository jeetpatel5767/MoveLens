// src/lib/memory/lancedb-memory.ts
// Layer 3 real implementation — backed by the Layer 4 Python sidecar's LanceDB corpus.
// Uses /recall and /remember endpoints from layer4_server.py.
//
// HARD RULES (same as all memory implementations):
//   - recall() MUST NEVER throw — return [] on any failure.
//   - remember() MUST NEVER throw — log warning and swallow.
//   - Only called through src/lib/memory/index.ts createMemory().

import type { Finding } from "../audit/schema";
import type { AuditMemory, MemoryHit } from "./index";
import { env } from "../env";

const SIDECAR = env.LAYER4_SIDECAR_URL ?? "http://localhost:8765";

// Map corpus sectors to the first registered Layer 1 rule ID for that sector.
// Used to synthesize schema-valid Findings from corpus hits.
const SECTOR_TO_RULE_ID: Record<string, string> = {
  "ML-INT": "ML-INT-001",
  "ML-ACC": "ML-ACC-001",
  "ML-HOT": "ML-HOT-001",
  "ML-OWN": "ML-OBJ-001",
  "ML-OBJ": "ML-OBJ-001",
  "ML-ARI": "ML-ARI-001",
  "ML-UPG": "ML-UPG-001",
  "ML-RAC": "ML-RAC-001",
  "ML-RET": "ML-RET-001",
  "ML-TOK": "ML-TOK-001",
  "ML-WRP": "ML-WRP-001",
  "ML-DOS": "ML-DOS-001",
  "ML-DEP": "ML-EXT-001",
  "ML-EXT": "ML-EXT-001",
  "ML-LOG": "ML-LOG-001",
};

interface RecallHit {
  name: string;
  sector: string;
  severity: string;
  score: number;
}

function sectorToCategory(sector: string): string {
  return sector.toLowerCase().replace("ml-", "");
}

function toValidSeverity(s: string): "critical" | "high" | "medium" | "low" {
  if (s === "critical" || s === "high" || s === "medium" || s === "low") return s;
  return "medium";
}

export class LanceDBMemory implements AuditMemory {
  async recall(query: string, namespace: string): Promise<MemoryHit[]> {
    if (!query.trim()) return [];

    try {
      const resp = await fetch(`${SIDECAR}/recall`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: query }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!resp.ok) return [];

      const data = await resp.json() as { hits?: RecallHit[] };
      const hits = data.hits ?? [];

      return hits
        .filter((h) => h.score > 0.5)
        .map((h): MemoryHit => {
          const ruleId = SECTOR_TO_RULE_ID[h.sector] ?? "ML-LOG-001";
          return {
            finding: {
              rule_id:        ruleId,
              severity:       toValidSeverity(h.severity),
              confidence:     Math.min(1.0, h.score),
              source:         "layer3",
              module:         "corpus",
              line_start:     0,
              line_end:       0,
              description:    `[Layer 3] Similar to corpus entry "${h.name}" (${h.sector}, score=${h.score.toFixed(3)})`,
              recommendation: `Review this pattern — it resembles known vulnerability: ${h.name}`,
              category:       sectorToCategory(h.sector),
            },
            similarity: h.score,
            namespace,
          };
        });
    } catch (err) {
      console.warn("[memory/lancedb] recall() failed:", err);
      return [];
    }
  }

  async remember(finding: Finding, namespace: string): Promise<void> {
    // Only embed actual code — descriptions are natural language and don't
    // produce useful code-similarity embeddings.
    const codeToStore = finding.impacted_code ?? null;
    if (!codeToStore) return; // nothing useful to store — skip silently

    try {
      await fetch(`${SIDECAR}/remember`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name:      `audit_finding_${finding.rule_id}_${Date.now()}`,
          sector:    `ML-${finding.category.toUpperCase()}`,
          severity:  finding.severity,
          code:      codeToStore,
          from_audit: true,
          namespace,
        }),
        signal: AbortSignal.timeout(8_000),
      });
    } catch (err) {
      console.warn("[memory/lancedb] remember() failed (non-fatal):", err);
    }
  }

  async healthy(): Promise<boolean> {
    try {
      const resp = await fetch(`${SIDECAR}/health`, {
        signal: AbortSignal.timeout(5_000),
      });
      if (!resp.ok) return false;
      const body = await resp.json() as { models_loaded?: boolean; status?: string };
      return body.status === "ok" && body.models_loaded === true;
    } catch {
      return false;
    }
  }
}
