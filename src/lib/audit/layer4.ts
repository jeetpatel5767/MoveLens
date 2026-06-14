/**
 * src/lib/audit/layer4.ts
 *
 * Layer 4 — ML model ensemble. The ONLY file in business logic allowed to:
 *   - Talk to the Python sidecar (port 8765)
 *   - Call Groq free-tier API (Model C, ONLY when confidence is 0.4–0.7)
 *
 * HARD RULES:
 *   - NEVER add paid third-party LLM API keys to this file. Free Groq tier only.
 *   - Groq is free tier only (GROQ_API_KEY env var, optional).
 *   - Layer 4 failure MUST NEVER throw — caller catches and continues.
 *   - Every emitted finding.rule_id MUST exist in rule-ids.ts VALID_RULE_IDS.
 *   - Drop and log invalid findings — never propagate unknown rule_ids.
 *
 * Pipeline per snippet:
 *   Model A: Jina embed → LanceDB cosine similarity > 0.75 → similarity flag
 *   Model B: Keyword heuristic classifier → { vulnerable, category, confidence, reason }
 *   Model C: Groq confirmation ONLY when 0.4 ≤ confidence ≤ 0.7 (skip if no GROQ_API_KEY)
 *   Final:   confidence = clamp(B.confidence + (A.similar ? +0.2 : 0) + (C.confirmed ? +0.1 : -0.1), 0, 1)
 */

import type { Finding, Severity } from "./schema";
import { FindingSchema } from "./schema";
import type { PackageContext } from "../sui/queries";
import type { MemoryHit } from "../memory/index";
import { env } from "../env";
import { VALID_RULE_IDS } from "./rule-ids";
import { sanitizeForPatterns } from "./sanitize";

const SIDECAR = env.LAYER4_SIDECAR_URL ?? "http://localhost:8765";

// ──────────────────────────────────────────────────────────────
// Groq rate limiter — 20 RPM (free tier hard cap)
// Exported so test/f33-verify.ts can reset state between tests.
// ──────────────────────────────────────────────────────────────

export const groqCallTimestamps: number[] = [];
const GROQ_RPM        = 20;
const GROQ_WINDOW_MS  = 60_000;

/**
 * Check whether a Groq call is allowed under the 20 RPM cap.
 * Records the call if allowed; logs and returns false if at limit.
 * Exported for testing.
 */
export function groqRateLimitOk(): boolean {
  const now = Date.now();
  // Evict timestamps outside the rolling window
  while (groqCallTimestamps.length > 0 && now - groqCallTimestamps[0] > GROQ_WINDOW_MS) {
    groqCallTimestamps.shift();
  }
  if (groqCallTimestamps.length >= GROQ_RPM) {
    console.warn("[layer4] Groq rate limit reached (20 RPM) — skipping Groq confirmation");
    return false;
  }
  groqCallTimestamps.push(now);
  return true;
}

// ──────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────

interface EmbedResult {
  similar_to: string | null;
  score:       number;
}

interface ClassifyResult {
  vulnerable: boolean;
  category:   string;   // ML-INT, ML-ACC, etc.
  confidence: number;
  reason:     string;
}

interface Snippet {
  code:    string;
  module:  string;
  line_start: number;
  line_end:   number;
}

// ──────────────────────────────────────────────────────────────
// Sidecar callers
// ──────────────────────────────────────────────────────────────

async function embedSnippet(code: string): Promise<EmbedResult> {
  const resp = await fetch(`${SIDECAR}/embed`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ code }),
    signal:  AbortSignal.timeout(10_000),
  });
  if (!resp.ok) throw new Error(`/embed ${resp.status}`);
  return resp.json() as Promise<EmbedResult>;
}

async function classifySnippet(code: string): Promise<ClassifyResult> {
  const resp = await fetch(`${SIDECAR}/classify`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ code }),
    signal:  AbortSignal.timeout(15_000),
  });
  if (!resp.ok) throw new Error(`/classify ${resp.status}`);
  return resp.json() as Promise<ClassifyResult>;
}

// ──────────────────────────────────────────────────────────────
// Model C: Groq confirmation (free tier — only for 0.4–0.7 range)
// ──────────────────────────────────────────────────────────────

async function confirmWithGroq(code: string, category: string): Promise<boolean> {
  const apiKey = env.GROQ_API_KEY;
  if (!apiKey) {
    // No key → skip, don't count as confirmation
    return false;
  }

  const prompt = `You are a Sui Move smart-contract security classifier.
Classify this snippet: is it vulnerable to a ${category} issue?
Answer with ONLY "YES" or "NO".

SNIPPET:
${code.slice(0, 800)}`;

  try {
    const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model:       "llama-3.3-70b-versatile",
        messages:    [{ role: "user", content: prompt }],
        max_tokens:  5,
        temperature: 0,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!resp.ok) {
      console.warn("[layer4] Groq API error:", resp.status);
      return false;
    }
    const data = await resp.json() as { choices?: { message?: { content?: string } }[] };
    const answer = data.choices?.[0]?.message?.content?.trim().toUpperCase() ?? "";
    return answer.startsWith("YES");
  } catch (err) {
    console.warn("[layer4] Groq call failed:", err);
    return false;
  }
}

// ──────────────────────────────────────────────────────────────
// Snippet extraction
// Extract ~20-line windows from module source/disassembly.
// Focuses on functions with arithmetic, access control patterns.
// ──────────────────────────────────────────────────────────────

const INTERESTING_RE = /(?:public|entry|fun\s+\w+|<<|>>|0x[0-9a-fA-F]{8,}|AdminCap|UpgradeCap|coin::|balance::|struct\s+\w+\s*\{)/;

const MAX_SNIPPETS_TOTAL = 20;  // hard global cap across all modules
const WINDOW = 20;              // lines per snippet

/**
 * Extract up to MAX_SNIPPETS_TOTAL suspicious 20-line windows from all modules.
 * No two returned snippets have overlapping [line_start, line_end] ranges.
 * Exported for testing.
 */
export function extractSuspiciousSnippets(ctx: PackageContext): Snippet[] {
  const snippets: Snippet[] = [];

  outer:
  for (const mod of ctx.modules) {
    const src = mod.source ?? mod.disassembly ?? "";
    if (!src) continue;

    const lines = src.split("\n");
    // Track [start, end] ranges already added for this module (0-indexed)
    const addedRanges: [number, number][] = [];

    for (let i = 0; i < lines.length; i++) {
      if (snippets.length >= MAX_SNIPPETS_TOTAL) break outer;

      const line = lines[i];
      if (!INTERESTING_RE.test(line)) continue;

      const start = Math.max(0, i - 2);
      const end   = Math.min(lines.length - 1, i + WINDOW - 1);

      // Skip if [start, end] overlaps any range already added for this module
      let overlap = false;
      for (const [rs, re] of addedRanges) {
        if (start <= re && end >= rs) { overlap = true; break; }
      }
      if (overlap) continue;

      addedRanges.push([start, end]);
      snippets.push({
        code:       lines.slice(start, end + 1).join("\n"),
        module:     mod.name,
        line_start: start + 1,  // 1-indexed
        line_end:   end + 1,
      });
    }
  }

  return snippets;
}

// ──────────────────────────────────────────────────────────────
// Rule ID derivation + recommendations
// ──────────────────────────────────────────────────────────────

/**
 * Convert the sidecar's "ML-INT" style category to the registered L4 rule ID.
 * e.g. "ML-INT" → "ML-INT-L4-001"
 */
function toRuleId(category: string): string {
  // sidecar returns e.g. "ML-INT", "ML-ACC", "ML-HOT", "ML-OWN", "ML-ARI",
  // "ML-UPG", "ML-RAC", "ML-RET", "ML-TOK", "ML-WRP", "ML-DOS", "ML-DEP", "ML-LOG"
  const ruleId = `${category}-L4-001`;
  if (!VALID_RULE_IDS.has(ruleId)) {
    console.warn(`[layer4] Unknown category "${category}" → rule_id "${ruleId}" not in registry; skipping`);
    return "";
  }
  return ruleId;
}

const RECOMMENDATIONS: Record<string, string> = {
  "ML-INT":  "Use u128 intermediate arithmetic and validate overflow masks before bit-shifts. See Cetus checked_shlw post-mortem.",
  "ML-ACC":  "Replace address-based checks with typed capabilities (AdminCap, OwnerCap). Verify ctx.sender() never implicitly granted.",
  "ML-HOT":  "Ensure hot-potato structs have NO abilities. Provide a paired consume/repay function in the same module.",
  "ML-OWN":  "Validate object IDs in capabilities; assert!(object::id(obj) == cap.target_id, EWrongTarget).",
  "ML-ARI":  "Use u128 intermediates; multiply before dividing. Add precision tests for edge cases.",
  "ML-UPG":  "Validate UpgradeCap package ID before delegating upgrades. Call package::make_immutable if upgrades are no longer needed.",
  "ML-RAC":  "Add staleness checks on oracles (clock timestamp delta). Use commit-reveal for price-sensitive operations.",
  "ML-RET":  "Never discard Option<T> or error results with let _ = .... Use option::destroy_some or propagate errors.",
  "ML-TOK":  "Zero pending balances before transferring rewards. Use checked arithmetic for all balance operations.",
  "ML-WRP":  "Provide an unwrap path for every wrap path. Document whether wrapped objects can be recovered.",
  "ML-DOS":  "Bound all loops with explicit iteration limits. Avoid on-chain unbounded recursion.",
  "ML-DEP":  "Pin external package dependencies by address. Audit imported modules for privilege escalation.",
  "ML-LOG":  "Add event emissions for all state-changing operations. Document rounding direction. Implement pause guards for emergency halts.",
};

function getRecommendation(category: string): string {
  return RECOMMENDATIONS[category] ?? "Review the code for security vulnerabilities identified by the ML model.";
}

function confidenceToSeverity(confidence: number): Severity {
  if (confidence >= 0.85) return "critical";
  if (confidence >= 0.70) return "high";
  if (confidence >= 0.50) return "medium";
  return "low";
}

// ──────────────────────────────────────────────────────────────
// Main Layer 4 function
// ──────────────────────────────────────────────────────────────

// ──────────────────────────────────────────────────────────────
// Per-snippet analysis (extracted so runLayer4 can batch in parallel)
// ──────────────────────────────────────────────────────────────

async function analyzeSnippet(
  snippet:     Snippet,
  memoryHits:  MemoryHit[],
): Promise<Finding | null> {
  try {
    // Sanitize comments/strings before sending to sidecar — defeats comment-based
    // prompt-injection and reduces false positives from patterns in comments.
    const cleanCode = sanitizeForPatterns(snippet.code, false);

    // ── Model A: Embedding similarity ──────────────────────────
    let simResult: EmbedResult = { similar_to: null, score: 0 };
    try {
      simResult = await embedSnippet(cleanCode);
    } catch (err) {
      console.warn("[layer4] /embed failed:", err);
    }

    // ── Model B: Classification ────────────────────────────────
    const classResult = await classifySnippet(cleanCode);

    if (!classResult.vulnerable && !simResult.similar_to) {
      return null; // nothing interesting
    }

    // Derive L4 rule ID
    const ruleId = toRuleId(classResult.category);
    if (!ruleId) return null; // unknown category → drop

    let confidence = classResult.confidence;

    // Boost if similarity match found (Model A confirms it).
    // Smaller boost (+0.15) and only when base confidence was < 0.8,
    // preventing the boost from pushing everything straight to critical.
    if (simResult.similar_to && confidence < 0.8) {
      confidence = Math.min(0.95, confidence + 0.15);
    }

    // ── Model C: Groq confirmation (only in uncertain range, rate-limited) ──
    if (confidence >= 0.4 && confidence <= 0.7 && env.GROQ_API_KEY) {
      if (!groqRateLimitOk()) {
        // rate limit logged inside groqRateLimitOk(); treat as unconfirmed
      } else {
        const confirmed = await confirmWithGroq(cleanCode, classResult.category);
        confidence = confirmed
          ? Math.min(1.0, confidence + 0.1)
          : Math.max(0.0, confidence - 0.1);
        console.log(`[layer4] Groq confirmation for ${ruleId}: ${confirmed} → confidence=${confidence.toFixed(2)}`);
      }
    }

    // Below threshold — skip
    if (confidence < 0.35) return null;

    // ── Assemble finding ───────────────────────────────────────
    const raw = {
      rule_id:        ruleId,
      severity:       confidenceToSeverity(confidence),
      confidence:     Math.round(confidence * 1000) / 1000,
      source:         "layer4" as const,
      module:         snippet.module,
      line_start:     snippet.line_start,
      line_end:       snippet.line_end,
      description:    simResult.similar_to
        ? `[Layer 4] Similar to known vulnerability "${simResult.similar_to}" (sim=${simResult.score.toFixed(3)}). ${classResult.reason}`
        : `[Layer 4] ${classResult.reason}`,
      recommendation: getRecommendation(classResult.category),
      category:       classResult.category.toLowerCase().replace("ml-", ""),
    };

    const parsed = FindingSchema.safeParse(raw);
    if (!parsed.success) {
      console.warn(`[layer4] Finding failed schema validation for ${ruleId}:`, parsed.error.flatten());
      return null;
    }

    return parsed.data;
  } catch (err) {
    console.warn("[layer4] Snippet analysis error:", err);
    return null; // never let Layer 4 kill the audit
  }
}

// ──────────────────────────────────────────────────────────────
// Main Layer 4 function
// ──────────────────────────────────────────────────────────────

/**
 * Run Layer 4 on all modules in a PackageContext.
 * Returns schema-valid findings with source: "layer4".
 * NEVER throws — any error is caught and returns [].
 *
 * Only called from engine.ts after sidecarHealthy() is confirmed.
 * Runs snippets in batches of 4 in parallel to stay within the 90s budget.
 */
export async function runLayer4(
  ctx:        PackageContext,
  memoryHits: MemoryHit[],
): Promise<Finding[]> {
  const snippets = extractSuspiciousSnippets(ctx);
  if (snippets.length === 0) {
    console.log("[layer4] No suspicious snippets found — skipping ML analysis.");
    return [];
  }

  console.log(`[layer4] Analysing ${snippets.length} snippet(s) across ${ctx.modules.length} module(s) (batches of 4)...`);

  const BATCH_SIZE = 4;
  const findings: Finding[] = [];

  for (let i = 0; i < snippets.length; i += BATCH_SIZE) {
    const batch = snippets.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(
      batch.map((snippet) => analyzeSnippet(snippet, memoryHits)),
    );
    for (const result of results) {
      if (result) findings.push(result);
    }
  }

  console.log(`[layer4] Produced ${findings.length} finding(s).`);
  return findings;
}
