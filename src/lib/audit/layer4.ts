/**
 * src/lib/audit/layer4.ts
 *
 * Layer 4 — ML model ensemble. The ONLY file in business logic allowed to:
 *   - Talk to the Python sidecar (port 8765)
 *   - Call Groq free-tier API (Model B primary classifier)
 *
 * HARD RULES:
 *   - NEVER add paid third-party LLM API keys to this file. Free Groq tier only.
 *   - Groq is free tier only (GROQ_API_KEY env var, optional).
 *   - Layer 4 failure MUST NEVER throw — caller catches and continues.
 *   - Every emitted finding.rule_id MUST exist in rule-ids.ts VALID_RULE_IDS.
 *   - Drop and log invalid findings — never propagate unknown rule_ids.
 *
 * Pipeline per snippet:
 *   Model A: Jina embed (sidecar) → LanceDB cosine similarity > 0.75 → boost flag
 *   Model B: Groq llama-3.3-70b-versatile (free tier) → full classification
 *            Falls back to sidecar keyword heuristic if Groq unavailable/rate-limited
 *   Final:   confidence = clamp(B.confidence + (A.similar && B.conf < 0.8 ? +0.15 : 0), 0, 1)
 */

import type { Finding, Severity } from "./schema";
import { FindingSchema } from "./schema";
import type { PackageContext } from "../sui/queries";
import type { MemoryHit } from "../memory/index";
import { env } from "../env";
import { VALID_RULE_IDS } from "./rule-ids";
import { sanitizeForPatterns } from "./sanitize";

const SIDECAR = env.LAYER4_SIDECAR_URL ?? "http://127.0.0.1:8765";

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
    console.warn("[layer4] Groq rate limit reached (20 RPM) — skipping Groq classification, using heuristic fallback");
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

// Only safe fields: rule_id (validated) and similarity (numeric).
// NEVER interpolate hit.finding.description or any freeform text — it could
// carry corpus-injected content straight into the sidecar model prompt.
function buildMemoryContext(memoryHits: MemoryHit[]): string {
  if (memoryHits.length === 0) return "";
  const examples = memoryHits.slice(0, 2).map((hit) => {
    // Strip everything except alphanumeric, hyphens, and underscores
    const safeRuleId = hit.finding.rule_id.replace(/[^a-zA-Z0-9\-_]/g, "").slice(0, 32);
    const safeScore  = hit.similarity.toFixed(2); // numeric, always safe
    return `KNOWN SIMILAR PATTERN: rule=${safeRuleId} (similarity ${safeScore})`;
  }).join("\n");
  return `\n\nADDITIONAL CONTEXT FROM PAST AUDITS:\n${examples}\n`;
}

async function classifyFallback(code: string): Promise<ClassifyResult> {
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
// Model B: Groq llama-3.3-70b-versatile — primary classifier
// ──────────────────────────────────────────────────────────────

const GROQ_PROMPT_TEMPLATE = `You are a Sui Move smart-contract security classifier.
Move is resource-oriented: capabilities (AdminCap) are access-control objects passed
as params; a hot potato struct has NO abilities; overflow aborts EXCEPT on bit-shifts.

Classify the SNIPPET into exactly one category:
ML-ACC, ML-INT, ML-HOT, ML-OWN, ML-ARI, ML-UPG, ML-RAC, ML-RET,
ML-TOK, ML-WRP, ML-DOS, ML-DEP, ML-LOG.
If not vulnerable, set vulnerable: false.
Output ONLY JSON — no markdown, no explanation outside the JSON.

EXAMPLE 1:
let mask = 0xffffffffffffffff << 192;
if (n > mask) abort; let r = n << 64;
-> {"vulnerable": true, "category": "ML-INT", "confidence": 0.95, "reason": "Wrong overflow mask before <<64 (Cetus-class)"}

EXAMPLE 2:
public fun create_admin_cap(_u: &UpgradeCap, to: address) {}
-> {"vulnerable": true, "category": "ML-ACC", "confidence": 0.90, "reason": "Capability minted without validating UpgradeCap package ID"}

EXAMPLE 3:
fun get_balance(account: &Account): u64 { account.balance }
-> {"vulnerable": false, "category": "ML-LOG", "confidence": 0.95, "reason": "Read-only accessor, no vulnerability"}

SNIPPET:
{code}

JSON only:`;

/**
 * Model B: Groq llama-3.3-70b-versatile (free tier) — primary classifier.
 * Returns null on ANY failure (missing key, rate limit, network error, bad JSON).
 * Caller MUST fall back to classifyFallback() on null.
 * NEVER throws.
 */
async function classifyWithGroq(rawCode: string, memoryContext: string): Promise<ClassifyResult | null> {
  const apiKey = env.GROQ_API_KEY;
  if (!apiKey) return null;
  if (!groqRateLimitOk()) return null;

  const cleanCode = sanitizeForPatterns(rawCode, false);
  const prompt = GROQ_PROMPT_TEMPLATE.replace("{code}", cleanCode.slice(0, 600)) + memoryContext;

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
        max_tokens:  150,
        temperature: 0.1,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!resp.ok) {
      console.warn("[layer4] Groq classify error:", resp.status);
      return null;
    }
    const data = await resp.json() as { choices?: { message?: { content?: string } }[] };
    const text = data.choices?.[0]?.message?.content?.trim() ?? "";
    const match = text.match(/\{[^{}]+\}/);
    if (!match) {
      console.warn("[layer4] Groq response had no JSON block:", text.slice(0, 100));
      return null;
    }
    const parsed = JSON.parse(match[0]);
    return {
      vulnerable: Boolean(parsed.vulnerable),
      category:   String(parsed.category ?? "ML-LOG"),
      confidence: Number(parsed.confidence ?? 0.5),
      reason:     String(parsed.reason ?? "Classified by Groq llama-3.3-70b"),
    };
  } catch (err) {
    console.warn("[layer4] Groq classify call failed:", err);
    return null;
  }
}

// ──────────────────────────────────────────────────────────────
// Snippet extraction
// Extract ~20-line windows from module source/disassembly.
// Focuses on functions with arithmetic, access control patterns.
// ──────────────────────────────────────────────────────────────

const INTERESTING_RE = /(?:public|entry|fun\s+\w+|<<|>>|0x[0-9a-fA-F]{8,}|AdminCap|UpgradeCap|coin::|balance::|struct\s+\w+\s*\{)/;

const MAX_SNIPPETS_TOTAL = 8;   // hard global cap across all modules
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
function toRuleId(input: string): string {
  // Accept full rule IDs ("ML-INT-L4-001") or category prefixes ("ML-INT")
  if (VALID_RULE_IDS.has(input)) return input;
  const ruleId = `${input}-L4-001`;
  if (VALID_RULE_IDS.has(ruleId)) return ruleId;
  console.warn(`[layer4] Unknown rule_id/category "${input}" — not in registry; skipping`);
  return "";
}

// Extract category prefix from either "ML-INT-L4-001" or "ML-INT"
function categoryOf(ruleIdOrCategory: string): string {
  return ruleIdOrCategory.replace(/-L4-\d+$/, "");
}

interface PatchSuggestion {
  recommendation: string;
  before: string;
  after:  string;
}

const PATCH_SUGGESTIONS: Partial<Record<string, PatchSuggestion>> = {
  "ML-INT": {
    recommendation: "Use checked_shl instead of raw bit-shifts. The Cetus exploit lost $223M to this pattern.",
    before: `let mask = 0xffffffffffffffff << 192;\nlet r = n << 64;`,
    after:  `// Aborts on overflow instead of silently truncating\nlet r = u256::checked_shl(n, 64);\nassert!(option::is_some(&r), EOverflow);`,
  },
  "ML-ACC": {
    recommendation: "Gate privileged functions with a typed capability argument instead of address checks.",
    before: `public fun withdraw(vault: &mut Vault, amount: u64,\n    ctx: &mut TxContext) { ... }`,
    after:  `public fun withdraw(_cap: &AdminCap, vault: &mut Vault,\n    amount: u64, ctx: &mut TxContext) { ... }`,
  },
  "ML-ARI": {
    recommendation: "Multiply before dividing and use u128 intermediates for fee calculations.",
    before: `let fee = amount / 10000 * fee_bps;`,
    after:  `// Multiply first to avoid precision loss\nlet fee = (amount as u128) * (fee_bps as u128) / 10000;\nlet fee = fee as u64;`,
  },
  "ML-HOT": {
    recommendation: "Hot-potato structs must have no abilities and a matched consume function.",
    before: `struct Receipt has copy, drop { amount: u64 }`,
    after:  `// No abilities — forces caller to consume it\nstruct Receipt { amount: u64 }\npublic fun consume(r: Receipt) {\n    let Receipt { amount: _ } = r;\n}`,
  },
  "ML-UPG": {
    recommendation: "Validate the UpgradeCap's package ID before authorizing upgrades.",
    before: `public fun upgrade(cap: &UpgradeCap, policy: u8,\n    digest: vector<u8>): UpgradeTicket {\n    package::authorize_upgrade(cap, policy, digest)\n}`,
    after:  `public fun upgrade(cap: &UpgradeCap, policy: u8,\n    digest: vector<u8>): UpgradeTicket {\n    assert!(package::upgrade_package(cap) == EXPECTED_PKG_ID,\n            EWrongPackage);\n    package::authorize_upgrade(cap, policy, digest)\n}`,
  },
};

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
  return (
    PATCH_SUGGESTIONS[category]?.recommendation ??
    RECOMMENDATIONS[category] ??
    "Review the code for security vulnerabilities identified by the ML model."
  );
}

function getPatch(category: string): { patch_before: string; patch_after: string } | null {
  const p = PATCH_SUGGESTIONS[category];
  return p ? { patch_before: p.before, patch_after: p.after } : null;
}

function confidenceToSeverity(confidence: number, ruleId?: string): Severity {
  // LOG findings are informational — cap at medium regardless of confidence
  if (ruleId?.includes("ML-LOG")) return confidence >= 0.60 ? "medium" : "low";
  if (confidence >= 0.85) return "critical";
  if (confidence >= 0.70) return "high";
  if (confidence >= 0.50) return "medium";
  return "low";
}

// ──────────────────────────────────────────────────────────────
// Full-source module analysis — sends entire module to Groq
// ──────────────────────────────────────────────────────────────

/**
 * Send the full module source to Groq and ask it to find ALL vulnerabilities.
 * Returns multiple findings per module. Falls back to [] on any failure.
 * NEVER throws.
 */
async function analyzeModuleWithGroq(
  mod:        { name: string; source?: string; disassembly?: string },
  memoryHits: MemoryHit[],
): Promise<Finding[]> {
  const apiKey = env.GROQ_API_KEY;
  if (!apiKey) return [];
  if (!groqRateLimitOk()) {
    console.warn(`[layer4] Groq rate limit — skipping full-source analysis for ${mod.name}`);
    return [];
  }

  const rawSource = mod.source ?? mod.disassembly ?? "";
  if (!rawSource.trim()) return [];

  const cleanSource = sanitizeForPatterns(rawSource, false);
  const memCtx     = buildMemoryContext(memoryHits);

  const prompt = `You are a senior Sui Move smart-contract security auditor. You have reviewed hundreds of contracts across DeFi, NFT, governance, bridge, and oracle protocols.

Analyze the FULL MODULE SOURCE below. Your goal: find EVERY real security vulnerability. Do not stop at the obvious ones.

══ MOVE SECURITY PRINCIPLES (apply to any contract type) ══

PRINCIPLE 1 — STRUCT ABILITY MISUSE
Any struct that represents value, ownership, obligation, or a lifecycle receipt must NOT have
"copy" or "drop" abilities. This applies universally — tokens, LP shares, flash loan receipts,
governance votes, NFT escrows, bridge locks, oracle commitments, any struct with financial meaning.
Having copy/drop lets attackers duplicate or silently discard these objects.
→ ML-HOT-L4-001

PRINCIPLE 2 — UNENFORCED OBLIGATIONS
Any function that creates an obligation (flash loan, escrow, vote, lock) by returning a struct
MUST have a paired consume function in the same module that takes ownership of that struct.
Without it, callers can drop the obligation struct and never fulfill it.
Search for: functions returning structs, check if a matching "repay/consume/close/settle" exists.
→ ML-RET-L4-001

PRINCIPLE 3 — ACCESS CONTROL ON STATE MUTATIONS
Any public function that writes to shared/global state (pool, vault, registry, config, treasury,
governance state, oracle price) must require a typed capability object as a parameter.
Address checks (ctx.sender() == owner) are weaker but still acceptable.
No guard at all → anyone can mutate critical state.
→ ML-ACC-L4-001

PRINCIPLE 4 — ARITHMETIC CORRECTNESS
- Division before multiplication: "a / b * c" always truncates. Should be "a * c / b".
- u64 * u64 can overflow at ~1.8e19. Financial calculations must use u128 intermediates.
- Bit-shifts on u256 with incorrect masks (Cetus-class) are critical exploits.
- Any division where the denominator is user-supplied or could be zero without a prior assert.
→ ML-ARI-L4-001 (precision), ML-INT-L4-001 (overflow/zero-div)

PRINCIPLE 5 — RESOURCE EXHAUSTION
Any loop iterating over a user-supplied collection (vector, table) with no length cap is a DoS
vector. Gas cost grows unbounded. Applies to batch operations, reward distributions, vote tallies.
→ ML-DOS-L4-001

PRINCIPLE 6 — OBJECT OWNERSHIP & UPGRADE SAFETY
- Capabilities must validate the object ID they control (assert!(object::id(obj) == cap.target)).
- UpgradeCap delegations must verify package ID before authorizing.
→ ML-OWN-L4-001, ML-UPG-L4-001

PRINCIPLE 7 — RACE CONDITIONS & ORACLE SAFETY
Price reads from external oracles with no staleness check (clock delta) are manipulable.
Commit-reveal patterns are needed for any operation sensitive to front-running.
→ ML-RAC-L4-001

VALID RULE IDs (pick the single best match per finding):
ML-INT-L4-001  integer overflow, bit-shift errors, divide-by-zero, unchecked u256 ops
ML-ACC-L4-001  unguarded public function mutates shared/global state
ML-HOT-L4-001  value/obligation struct incorrectly has copy or drop ability
ML-ARI-L4-001  arithmetic precision loss: divide-before-multiply, truncation in fee/share math
ML-OWN-L4-001  object ID or ownership not validated in capability
ML-UPG-L4-001  upgrade authority delegated without package ID verification
ML-RAC-L4-001  stale oracle read, front-running risk, missing commit-reveal
ML-RET-L4-001  obligation/receipt/option return value silently discarded or unenforced
ML-TOK-L4-001  token balance not zeroed before transfer, double-spend risk
ML-WRP-L4-001  wrapped object has no unwrap/recovery path
ML-DOS-L4-001  unbounded loop or recursion over user-controlled input
ML-DEP-L4-001  external package used without address validation
ML-LOG-L4-001  critical state change emits no event (low severity — use sparingly)${memCtx}

MODULE: ${mod.name}
SOURCE (1-indexed lines):
${cleanSource.slice(0, 3500)}

MANDATORY CHECKLIST — work through every item before writing output:
□ Every struct definition: does it represent value/obligation? Does it have copy or drop? → HOT
□ Every function returning a struct: is there a matching consume/repay in this module? → RET
□ Every public function writing to shared state: does it have a capability param? → ACC
□ Every division operator (/): denominator zero risk? Multiply before divide? → INT / ARI
□ Every u64 multiplication: overflow risk without u128? → INT
□ Every loop: bounded iteration? User-controlled length? → DOS
□ Every capability: validates the object ID it controls? → OWN
□ Every oracle/price read: staleness check present? → RAC

CONFIDENCE: 0.95 = certain exploit, 0.80 = very likely, 0.65 = probable, skip below 0.60.
ML-LOG-L4-001 max confidence = 0.65. Never rate missing-event findings as critical.

Output ONLY a JSON array:
{"rule_id":"<VALID RULE ID>","line_start":<int>,"line_end":<int>,"confidence":<float>,"reason":"<one sentence naming the specific function or struct and why it is vulnerable>"}

If no vulnerabilities: []
JSON array only — no markdown, no explanation outside the array:`;

  try {
    const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method:  "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model:       "llama-3.3-70b-versatile",
        messages:    [{ role: "user", content: prompt }],
        max_tokens:  800,
        temperature: 0.1,
      }),
      signal: AbortSignal.timeout(20_000),
    });

    if (!resp.ok) {
      console.warn(`[layer4] Full-source Groq error for ${mod.name}:`, resp.status);
      return [];
    }

    const data = await resp.json() as { choices?: { message?: { content?: string } }[] };
    const text = data.choices?.[0]?.message?.content?.trim() ?? "";
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) {
      console.warn(`[layer4] No JSON array in Groq response for ${mod.name}`);
      return [];
    }

    // Strip trailing commas before closing brackets/braces (common Groq output bug)
    const cleaned = match[0].replace(/,\s*([}\]])/g, "$1");
    const items = JSON.parse(cleaned) as Array<{
      rule_id:    string;
      line_start: number;
      line_end:   number;
      confidence: number;
      reason:     string;
    }>;

    const lines    = rawSource.split("\n");
    const findings: Finding[] = [];

    for (const item of items) {
      const ruleId = toRuleId(item.rule_id);
      if (!ruleId) continue;

      const confidence = Math.min(1, Math.max(0, Number(item.confidence) || 0.5));
      if (confidence < 0.5) continue;

      const lineStart    = Math.max(1, Math.floor(item.line_start) || 1);
      const lineEnd      = Math.max(lineStart, Math.floor(item.line_end) || lineStart);
      const impactedCode = lines.slice(lineStart - 1, lineEnd).join("\n").slice(0, 1000);
      const cat          = categoryOf(ruleId);
      const patch        = getPatch(cat);

      const raw = {
        rule_id:        ruleId,
        severity:       confidenceToSeverity(confidence, ruleId),
        confidence:     Math.round(confidence * 1000) / 1000,
        source:         "layer4" as const,
        module:         mod.name,
        line_start:     lineStart,
        line_end:       lineEnd,
        description:    `[Layer 4] ${String(item.reason ?? "").slice(0, 300)}`,
        recommendation: getRecommendation(cat),
        category:       cat.toLowerCase().replace("ml-", ""),
        impacted_code:  impactedCode,
        patch_before:   patch?.patch_before ?? null,
        patch_after:    patch?.patch_after  ?? null,
      };

      const validated = FindingSchema.safeParse(raw);
      if (!validated.success) {
        console.warn(`[layer4] Schema validation failed for ${ruleId}:`, validated.error.flatten());
        continue;
      }
      findings.push(validated.data);
    }

    console.log(`[layer4] Module ${mod.name}: Groq found ${findings.length} finding(s)`);
    return findings;
  } catch (err) {
    console.warn(`[layer4] Full-source analysis failed for ${mod.name}:`, err);
    return [];
  }
}

// ──────────────────────────────────────────────────────────────
// Heuristic fallback — used when Groq is unavailable
// ──────────────────────────────────────────────────────────────

async function runHeuristicFallback(
  ctx:        PackageContext,
  memoryHits: MemoryHit[],
): Promise<Finding[]> {
  const snippets = extractSuspiciousSnippets(ctx);
  if (snippets.length === 0) return [];

  console.log(`[layer4] Heuristic fallback: ${snippets.length} snippet(s)`);
  const findings: Finding[] = [];

  for (const snippet of snippets) {
    try {
      const cleanCode   = sanitizeForPatterns(snippet.code, false);
      const classResult = await classifyFallback(cleanCode);
      if (!classResult.vulnerable) continue;

      const ruleId = toRuleId(classResult.category);
      if (!ruleId) continue;

      const cat   = categoryOf(ruleId);
      const patch = getPatch(cat);
      const raw   = {
        rule_id:        ruleId,
        severity:       confidenceToSeverity(classResult.confidence),
        confidence:     Math.round(classResult.confidence * 1000) / 1000,
        source:         "layer4" as const,
        module:         snippet.module,
        line_start:     snippet.line_start,
        line_end:       snippet.line_end,
        description:    `[Layer 4] ${classResult.reason}`,
        recommendation: getRecommendation(cat),
        category:       cat.toLowerCase().replace("ml-", ""),
        impacted_code:  cleanCode.slice(0, 1000),
        patch_before:   patch?.patch_before ?? null,
        patch_after:    patch?.patch_after  ?? null,
      };
      const validated = FindingSchema.safeParse(raw);
      if (validated.success) findings.push(validated.data);
    } catch {
      // swallow — never let fallback kill the audit
    }
  }

  return findings;
}

// ──────────────────────────────────────────────────────────────
// Main Layer 4 entry point
// ──────────────────────────────────────────────────────────────

/**
 * Run Layer 4 on all modules.
 * Primary path: full module source → Groq (finds everything, no pre-filtering).
 * Fallback path: INTERESTING_RE snippet extraction → sidecar heuristic (when no Groq key).
 * NEVER throws — all errors caught internally.
 */
export async function runLayer4(
  ctx:        PackageContext,
  memoryHits: MemoryHit[],
): Promise<Finding[]> {
  if (ctx.modules.length === 0) return [];

  const hasGroq = Boolean(env.GROQ_API_KEY);

  if (hasGroq) {
    console.log(`[layer4] Full-source Groq analysis across ${ctx.modules.length} module(s)...`);
    const results = await Promise.all(
      ctx.modules.map((mod) => analyzeModuleWithGroq(mod, memoryHits)),
    );
    const findings = results.flat();
    console.log(`[layer4] Produced ${findings.length} finding(s) total.`);
    return findings;
  }

  // No Groq key — heuristic sidecar fallback
  return runHeuristicFallback(ctx, memoryHits);
}

// ──────────────────────────────────────────────────────────────
// Review pass — Groq audits the merged report for noise
// ──────────────────────────────────────────────────────────────

/**
 * Final quality pass: send the full merged finding list to Groq and ask it
 * to identify duplicates, cross-layer redundancy, and false positives.
 *
 * Conservative by design — Groq is instructed to keep findings when in doubt.
 * NEVER throws — returns original findings on any failure.
 * Only called from engine.ts after mergeAndDedupe + sortFindings.
 */
export async function reviewFindings(findings: Finding[]): Promise<Finding[]> {
  if (findings.length === 0) return findings;

  const apiKey = env.GROQ_API_KEY;
  if (!apiKey) return findings;
  if (!groqRateLimitOk()) {
    console.warn("[layer4] Groq rate limit — skipping review pass, returning all findings");
    return findings;
  }

  // Compact summary — no impacted_code to keep token count low
  const summary = findings.map((f) => ({
    key:        `${f.rule_id}:${f.module}:${f.line_start}`,
    rule_id:    f.rule_id,
    severity:   f.severity,
    confidence: f.confidence,
    source:     f.source,
    module:     f.module,
    line_start: f.line_start,
    description: f.description.slice(0, 150),
  }));

  const prompt = `You are a senior Sui Move security auditor performing a final deduplication and quality pass on an automated audit report. This report may cover any type of Move smart contract — DeFi, NFT, governance, bridge, oracle, or custom protocol.

══ CORE PRINCIPLE YOU MUST APPLY ══

Every rule ID encodes a sector prefix. Extract it like this:
  "ML-ACC-001"    → sector "ML-ACC"
  "ML-ACC-007"    → sector "ML-ACC"
  "ML-ACC-L4-001" → sector "ML-ACC"
  "ML-INT-002"    → sector "ML-INT"
  "ML-INT-L4-001" → sector "ML-INT"
  "ML-DOS-001"    → sector "ML-DOS"
  "ML-DOS-L4-001" → sector "ML-DOS"
  Rule: strip the trailing "-NNN" or "-L4-NNN" to get the sector. The sector is always "ML-XXX".

SOURCE TRUST HIERARCHY (highest to lowest):
  layer1 > layer2 > layer4

══ DROP RULES — apply universally to ANY rule ID, ANY sector, ANY contract type ══

RULE 1 — CROSS-LAYER SECTOR DUPLICATE:
  IF a layer4 finding and a layer1/layer2 finding share:
    - the same sector prefix (derived as shown above)
    - the same module
    - line_start values within 15 lines of each other
  THEN drop the layer4 finding. Keep the layer1/layer2 one.
  This applies to EVERY sector (ACC, INT, HOT, ARI, DOS, RET, TOK, LOG, OWN, UPG, RAC, WRP, DEP).
  It is not limited to specific rule IDs — it is a universal principle.

RULE 2 — SAME-RULE REPETITION:
  IF the same rule_id appears multiple times on the same module with line_start values within 5 lines,
  keep only the one with the highest confidence. Drop the rest.

RULE 3 — FALSE POSITIVE:
  IF a description contains phrases like "not vulnerable", "read-only accessor", "no vulnerability detected",
  drop that finding regardless of source.

══ KEEP RULES — never violate these ══
- NEVER drop a layer1 or layer2 finding for any reason.
- NEVER drop a layer4 finding whose sector is NOT covered by any layer1/layer2 finding in the same module.
  (These are genuine additions — Groq found something the deterministic rules missed.)
- When uncertain, KEEP. A false negative is worse than a duplicate.

FINDINGS (${findings.length} total):
${JSON.stringify(summary, null, 2)}

Apply the rules above systematically. Go through every layer4 finding and check:
  1. Does its sector appear in any layer1/layer2 finding in the same module within 15 lines? → drop it
  2. Is it a same-rule repeat? → drop lower confidence copy
  3. Is its description a false positive? → drop it

Respond ONLY with valid JSON:
{"drop": [{"key": "RULE_ID:MODULE:LINE_NUMBER", "reason": "one line — state the rule that triggered"}]}
If nothing to drop: {"drop": []}`;

  try {
    const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method:  "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model:       "llama-3.3-70b-versatile",
        messages:    [{ role: "user", content: prompt }],
        max_tokens:  500,
        temperature: 0.0,
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!resp.ok) {
      console.warn("[layer4] Review pass — Groq error:", resp.status, "returning original findings");
      return findings;
    }

    const data = await resp.json() as { choices?: { message?: { content?: string } }[] };
    const text = data.choices?.[0]?.message?.content?.trim() ?? "";
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) {
      console.warn("[layer4] Review pass — no JSON in Groq response, returning original findings");
      return findings;
    }

    const cleaned = match[0].replace(/,\s*([}\]])/g, "$1");
    const parsed = JSON.parse(cleaned) as { drop?: { key: string; reason: string }[] };
    const drops = parsed.drop ?? [];

    if (drops.length === 0) {
      console.log("[layer4] Review pass: all findings confirmed clean");
      return findings;
    }

    const toDrop = new Set(drops.map((d) => d.key));
    for (const d of drops) {
      console.log(`[layer4] Review pass removed: ${d.key} — ${d.reason}`);
    }

    const reviewed = findings.filter(
      (f) => !toDrop.has(`${f.rule_id}:${f.module}:${f.line_start}`)
    );

    console.log(
      `[layer4] Review pass: ${findings.length} → ${reviewed.length} findings (removed ${drops.length})`
    );
    return reviewed;
  } catch (err) {
    console.warn("[layer4] Review pass failed — returning original findings:", err);
    return findings;
  }
}
