# MoveLens — Implementation Checklist for Claude Code

> **Project:** AI-powered Sui Move security auditor. Analyzes contracts via a zero-cost 4-layer hybrid engine, benchmarks against OpenZeppelin safe patterns, stores encrypted audit reports on Walrus, links them to packages via MVR.
>
> **Hackathon:** Sui Overflow 2026 — Walrus Specialized Track — Solo Builder — **Deadline: June 21, 2026**
>
> **How to use this checklist:** Work through phases sequentially. Each phase has `Setup`, `Build`, and `Verify` blocks. Every task maps to one or more entries in `features.json`. NEVER mark a feature as passing without completing the Verify steps for it. Pseudocode blocks are overviews — verify exact SDK signatures against live docs at implementation time.
>
> **HARD RULES (apply to every task):**
> - NEVER use Sui JSON-RPC anywhere. It shuts down July 31, 2026. Sui GraphQL only.
> - NEVER add any paid API call (Anthropic, OpenAI, Gemini, Cohere) anywhere in this codebase. No `ANTHROPIC_API_KEY`, no `callClaude()`. If found, delete immediately.
> - Pin `@mysten-incubation/memwal` to an exact version. All MemWal calls go through `src/lib/memory/` — never call the SDK directly from business logic. Same for Layer 4: only through `src/lib/audit/layer4.ts`.
> - Every report carries the watermark: `"Automated pre-screen — not a substitute for a human audit."`
> - Every finding carries `rule_id`, `confidence`, and a line range.
> - Keep on-chain Move ≤ ~150 lines. All complexity lives in the TypeScript pipeline.

---

# STATUS MAP

```
Phase 0 — Scaffolding + harness files                 ✅ done by initializer
Phase 1 — Package Ingest (GraphQL + MVR)              ❌ NOT STARTED
Phase 2 — 4-Layer Hybrid Audit Engine                 ❌ NOT STARTED
Phase 3 — Report Assembly + Seal Encryption           ❌ NOT STARTED
Phase 4 — Walrus Storage (Quilt + Blob)               ❌ NOT STARTED
Phase 5 — MVR On-Chain Linking                        ❌ NOT STARTED
Phase 6 — MemWal Agent Memory (= Layer 3)             ❌ NOT STARTED
Phase 7 — Frontend (Next.js 15)                       ❌ NOT STARTED
Phase 8 — Polish + Demo Readiness                     ❌ NOT STARTED
```

> **Priority order for the 10-day runway (per BRIEFING.md):**
> 1. Phases 1→4 (core Walrus track) — Layer 1 + Layer 2 of the engine only
> 2. Phase 5 (MVR on-chain linking — high judge value, small effort)
> 3. Phase 6 (MemWal = Layer 3 — strong differentiator)
> 4. Layer 4 tasks 2.5–2.8 / features F25–F28 (nice to have — implement ONLY after Phases 1–5 are green)
> 5. Phase 7 (frontend)
> 6. Phase 8 (polish)
>
> If time runs out, Layer 1 + Layer 2 + Layer 3 alone are enough to win the Walrus track. Layer 4 is a bonus.

---

# PHASE 0 — Scaffolding ✅ (initializer output)

Project structure that all later tasks assume:

```
movelens/
├── CLAUDE.md                  # session protocol — Claude Code reads this first
├── IMPLEMENTATION.md          # this file
├── features.json              # feature tracker — only flip "passes"
├── progress.txt               # session log
├── init.sh                    # health check + dev server bootstrap
├── movelens_vuln_corpus_classified.md  # 93-rule corpus (source of truth for Layer 1)
├── .env.example               # all required env vars, documented
├── package.json               # single workspace root (Next.js 15 app)
├── requirements.txt           # Python sidecar deps: sentence-transformers, lancedb, flask, transformers, torch
├── src/
│   ├── app/                   # Next.js App Router (frontend + API routes)
│   │   ├── page.tsx           # landing: paste address / upload source
│   │   ├── audit/[id]/page.tsx# report view
│   │   └── api/
│   │       ├── audit/route.ts # POST: start audit; GET: status
│   │       └── report/[id]/route.ts
│   ├── lib/
│   │   ├── env.ts             # zod-validated env loader
│   │   ├── sui/
│   │   │   ├── graphql.ts     # Sui GraphQL client (NEVER JSON-RPC)
│   │   │   └── queries.ts     # typed GraphQL queries
│   │   ├── mvr/
│   │   │   ├── resolve.ts     # reverse resolution: package ID → name
│   │   │   └── metadata.ts    # set_metadata() transaction builder
│   │   ├── audit/
│   │   │   ├── engine.ts      # orchestrates all 4 layers
│   │   │   ├── layer1.ts      # 93 deterministic rules (regex + AST)
│   │   │   ├── layer2.ts      # 10 OZ math deviation checks
│   │   │   ├── layer4.ts      # HF model ensemble caller (sidecar HTTP)
│   │   │   ├── rules.ts       # full rule registry (93 + 10 OZ rules)
│   │   │   └── schema.ts      # Finding / Report zod schemas
│   │   ├── memory/            # Layer 3
│   │   │   ├── index.ts       # AuditMemory interface (abstraction)
│   │   │   ├── memwal.ts      # MemWal implementation
│   │   │   └── noop.ts        # fallback stub if MemWal is down
│   │   ├── seal/
│   │   │   └── encrypt.ts     # Seal threshold encryption wrapper
│   │   └── walrus/
│   │       ├── quilt.ts       # bundle report files into a quilt
│   │       └── upload.ts      # blob upload, returns blob ID
│   └── store/
│       └── audits.ts          # in-process audit job store (Map) — no DB for MVP
├── move/                      # optional tiny on-chain module (Phase 5, ≤150 lines)
├── test/
│   ├── fixtures/              # known-vulnerable Move source samples
│   └── smoke.ts               # end-to-end smoke test used by init.sh
├── lancedb_store/             # auto-created by seedLanceDB.ts, gitignored
└── scripts/
    ├── layer4_server.py       # Python sidecar: Jina embeddings + DeepSeek classification (port 8765)
    ├── seedLanceDB.ts         # one-time: seeds LanceDB with known-vulnerable snippets
    ├── seed-fixtures.ts
    └── demo.md
```

**Stack decision (final):** Single Next.js 15 + TypeScript app. All Sui-ecosystem SDKs (`@mysten/sui`, `@mysten/walrus`, `@mysten/seal`, `@mysten-incubation/memwal`) are TypeScript — one language, one repo, one deploy. No Rust backend, no PostgreSQL. An in-process job store is enough for a hackathon demo. The AI engine is a zero-cost 4-layer hybrid system: Layer 1 (93 deterministic rules), Layer 2 (OZ math benchmark), Layer 3 (MemWal semantic memory), Layer 4 (local Jina embeddings + DeepSeek-1.3B + free Groq confirmation). No paid API keys anywhere. The only Python in the project is the Layer 4 sidecar (`scripts/layer4_server.py`).

---

# PHASE 1 — Package Ingest (Sui GraphQL + MVR Resolution)

**Phase goal:** Given a Sui package address (or pasted Move source), produce a normalized `PackageContext` object containing module source/bytecode info, upgrade history, and a human-readable MVR name.

## Phase 1 — Setup

### Task 1.0 — Dependencies + env

- [ ] `npm install @mysten/sui zod`
- [ ] `.env.example` entries:
  ```
  SUI_GRAPHQL_URL=https://sui-testnet.mystenlabs.com/graphql
  SUI_NETWORK=testnet
  WALRUS_NETWORK=testnet
  SUI_KEYPAIR_B64=                 # funded testnet keypair for Walrus/MVR txs
  LAYER4_SIDECAR_URL=http://localhost:8765
  GROQ_API_KEY=                    # free at console.groq.com — for Layer 4 Model C only
  OPENROUTER_API_KEY=              # alternative free option for Model C
  MEMWAL_ENABLED=true
  ```
  **FORBIDDEN env vars:** `ANTHROPIC_API_KEY`, `AUDIT_MODEL`, `OPENAI_API_KEY` — never add these.
- [ ] `src/lib/env.ts` — zod-validated env loader. Fail fast with a readable error listing missing vars.

**Pseudocode:**
```typescript
// src/lib/env.ts
const EnvSchema = z.object({
  SUI_GRAPHQL_URL: z.string().url(),
  SUI_NETWORK: z.enum(["testnet", "mainnet"]),
  WALRUS_NETWORK: z.enum(["testnet", "mainnet"]),
  SUI_KEYPAIR_B64: z.string().min(1),
  LAYER4_SIDECAR_URL: z.string().url().default("http://localhost:8765"),
  GROQ_API_KEY: z.string().optional(),        // free tier, Layer 4 Model C only
  OPENROUTER_API_KEY: z.string().optional(),  // free alternative for Model C
  MEMWAL_ENABLED: z.coerce.boolean().default(true),
});

export const env = (() => {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error("Missing/invalid env vars:", parsed.error.flatten().fieldErrors);
    process.exit(1);
  }
  return parsed.data;
})();
```

## Phase 1 — Build

### Task 1.1 — Sui GraphQL client

In `src/lib/sui/graphql.ts`:

- [ ] Thin `fetch`-based GraphQL client: `suiQuery<T>(query: string, variables: object): Promise<T>`.
- [ ] Retries: 3 attempts, exponential backoff (500ms base), only on 5xx/network errors.
- [ ] Throw `SuiGraphQLError` with the GraphQL `errors` array attached.
- [ ] **Guardrail:** comment block at top: `// JSON-RPC is FORBIDDEN in this codebase (sunsets 2026-07-31). GraphQL only.`

**Pseudocode:**
```typescript
// src/lib/sui/graphql.ts
// JSON-RPC is FORBIDDEN in this codebase (sunsets 2026-07-31). GraphQL only.

export class SuiGraphQLError extends Error {
  constructor(msg: string, public gqlErrors?: unknown[]) { super(msg); }
}

export async function suiQuery<T>(query: string, variables: object = {}): Promise<T> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(env.SUI_GRAPHQL_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, variables }),
      });
      if (res.status >= 500) throw new Error(`5xx: ${res.status}`); // retryable
      const json = await res.json();
      if (json.errors?.length) throw new SuiGraphQLError("GraphQL errors", json.errors); // NOT retryable
      return json.data as T;
    } catch (e) {
      if (e instanceof SuiGraphQLError || attempt === 3) throw e;
      await sleep(500 * 2 ** (attempt - 1)); // 500ms, 1s
    }
  }
  throw new Error("unreachable");
}
```

### Task 1.2 — Package fetch query

In `src/lib/sui/queries.ts`:

- [ ] `fetchPackage(packageId: string): Promise<PackageContext>` retrieving: package address, version, `modules { nodes { name, bytes, disassembly } }`, publisher, upgrade history.
- [ ] Handle: invalid address format (reject before querying), package not found (typed `PackageNotFoundError`).

**Pseudocode:**
```typescript
// src/lib/sui/queries.ts
export interface ModuleInfo { name: string; source: string | null; disassembly: string; }

export interface PackageContext {
  packageId: string;
  network: "testnet" | "mainnet";
  mvrName: string | null;          // filled by Task 1.3
  sourceRepo: string | null;       // filled by Task 1.3
  version: number;
  upgradeCount: number;            // signal for ML-UPG rules
  modules: ModuleInfo[];
  fetchedAt: string;               // ISO 8601
}

const PACKAGE_QUERY = `
  query ($id: SuiAddress!) {
    package(address: $id) {
      address
      version
      modules { nodes { name disassembly } }
      previousTransactionBlock { digest }
    }
  }`; // verify exact field names against live GraphQL schema at implementation time

export async function fetchPackage(packageId: string): Promise<PackageContext> {
  if (!/^0x[0-9a-fA-F]{1,64}$/.test(packageId)) throw new InvalidAddressError(packageId);
  const data = await suiQuery<any>(PACKAGE_QUERY, { id: packageId });
  if (!data.package) throw new PackageNotFoundError(packageId);
  return normalize(data.package); // → PackageContext, upgradeCount from version history
}
```

### Task 1.3 — MVR reverse resolution

In `src/lib/mvr/resolve.ts`:

- [ ] `resolvePackageName(packageId)` → calls MVR reverse-resolution endpoint (mainnet: `https://mainnet.mvr.mystenlabs.com`, testnet equivalent) per https://docs.suins.io/move-registry — verify exact route from docs at implementation time.
- [ ] No MVR name is NOT an error — return nulls and continue. 5s timeout; on timeout log warning and return nulls. MVR resolution must never block an audit.

**Pseudocode:**
```typescript
// src/lib/mvr/resolve.ts
export async function resolvePackageName(
  packageId: string
): Promise<{ name: string | null; sourceRepo: string | null }> {
  try {
    const res = await fetch(`${MVR_BASE}/v1/reverse-resolution/${packageId}`, {
      signal: AbortSignal.timeout(5000),
    }); // verify exact route in MVR docs
    if (!res.ok) return { name: null, sourceRepo: null };
    const data = await res.json();
    return { name: data.name ?? null, sourceRepo: data.metadata?.source ?? null };
  } catch {
    console.warn(`MVR resolution timed out/failed for ${packageId} — continuing without name`);
    return { name: null, sourceRepo: null };
  }
}
```

### Task 1.4 — Source upload path

In `src/app/api/audit/route.ts` (partial — full route in Phase 7):

- [ ] Accept either `{ packageId }` or `{ source: { files: { name, content }[] } }`.
- [ ] For uploaded source: every file ends `.move`, total ≤ 1 MB, ≥ 1 file contains `module`.
- [ ] Build a `PackageContext` with `packageId: "local-upload"`, modules from provided source (`source` field populated, `disassembly` empty).

## Phase 1 — Verify

- [ ] `fetchPackage` on a real, known testnet package returns ≥ 1 module with non-empty disassembly.
- [ ] `fetchPackage` on a garbage address throws `PackageNotFoundError`, not a crash.
- [ ] `resolvePackageName` on a known MVR-registered mainnet package returns a name like `@deepbook/core`; on an unregistered package returns nulls without throwing.
- [ ] `grep -ri "jsonrpc\|fullnode.*:443\|sui_get" src/` returns ZERO matches.

---

# PHASE 2 — 4-Layer Hybrid Audit Engine (ZERO COST)

**Phase goal:** Given a `PackageContext`, run the 4-layer engine and emit a validated array of structured `Finding`s. **No paid API calls. Ever.**

```
Layer 1 — 93 deterministic rules (regex + AST), 13 sectors      confidence = 1.0
Layer 2 — 10 OZ DeFi math deviation checks (deterministic)      confidence = 0.95
Layer 3 — MemWal semantic memory recall (before) + remember (after)
Layer 4 — Model ensemble: Jina embeddings → DeepSeek-1.3B → Groq free tier
```

## Phase 2 — Setup

### Task 2.0 — Schemas + rule registry (93 rules, 13 sectors)

In `src/lib/audit/schema.ts`:

- [ ] ```typescript
  const Severity = z.enum(["critical", "high", "medium", "low", "info"]);

  const Finding = z.object({
    rule_id: z.string().regex(/^ML-[A-Z]+-(\d{3}|L4-\d{3})$/),  // ML-INT-001 or ML-INT-L4-001
    severity: Severity,
    confidence: z.number().min(0).max(1),
    title: z.string().max(160),
    description: z.string(),
    location: z.object({
      module: z.string(),
      function: z.string().nullable(),
      line_start: z.number().nullable(),
      line_end: z.number().nullable(),
    }),
    impacted_code: z.string().nullable(),
    recommendation: z.string(),
    category: z.enum([
      "access_control", "object_ownership", "integer_overflow",
      "arithmetic_precision", "hot_potato", "unsafe_upgrade",
      "race_condition", "unchecked_return", "token_management",
      "object_wrapping", "denial_of_service", "dependency_security",
      "design_logic",
    ]),
    source: z.enum(["layer1", "layer2_oz", "layer4"]),
    similar_to: z.string().nullable().default(null),  // Layer 4: known-exploit name
  });

  const AuditReport = z.object({
    report_id: z.string().uuid(),
    package: PackageContextSummary,
    findings: z.array(Finding),
    memory_context_used: z.boolean(),
    layers_run: z.array(z.string()),     // e.g. ["layer1","layer2","layer3","layer4"]
    watermark: z.literal("Automated pre-screen — not a substitute for a human audit."),
    generated_at: z.string(),
    engine_version: z.string(),
  });
  ```
- [ ] In `src/lib/audit/rules.ts`: **parse `movelens_vuln_corpus_classified.md` manually and convert each rule into a `Rule` object with a compiled `RegExp`.** The corpus tags each rule: ⚙️ REGEX (65 rules — implement first), 🔍 AST (19 rules), ⏭️ SKIP_MVP (9 rules — skip). The 13 sector prefixes:
  `ML-ACC` (Access Control), `ML-OWN` (Object Ownership), `ML-INT` (Integer Overflow/Bitwise), `ML-ARI` (Arithmetic Precision), `ML-HOT` (Hot Potato/Flash Loan), `ML-UPG` (Unsafe Upgrades), `ML-RAC` (Race Conditions), `ML-RET` (Unchecked Returns), `ML-TOK` (Token/Coin), `ML-WRP` (Wrapping/Unwrapping), `ML-DOS` (Denial of Service), `ML-DEP` (Dependency Security), `ML-LOG` (Design Logic).
- [ ] Rule object format:
  ```typescript
  interface Rule {
    id: string;                       // "ML-INT-001"
    sector: string;                   // "ML-INT"
    type: "regex" | "ast";
    pattern?: RegExp;                 // for regex rules
    astCheck?: (m: ModuleInfo) => Finding[];  // for AST rules
    severity: Severity;
    description: string;
    recommendation: string;
  }
  ```
- [ ] **The registry is the only source of truth for rule_ids.** Findings referencing unknown ids are DROPPED and logged — never invented, never "fixed up".

### Task 2.1 — Test fixtures

In `test/fixtures/`:

- [ ] Write 4 small intentionally-vulnerable Move modules (each < 80 lines):
  - `vulnerable_cap.move` — capability minted without validating UpgradeCap package ID (Pawtato class → ML-ACC-008)
  - `missing_signer.move` — public fun modifying privileged state, no capability/sender check (ML-ACC-001)
  - `overflow.move` — Cetus-class `checked_shlw` with wrong mask `0xffffffffffffffff << 192` + raw `<< 64` on u256 (ML-INT-001 / ML-OZ-001)
  - `clean.move` — correct module using OZ-safe patterns; must produce ZERO critical/high findings
- [ ] Each fixture has a sibling `expected.json` listing the rule_ids that MUST be found (and for `clean.move`, must NOT be found above `low`).

## Phase 2 — Build

### Task 2.2 — Layer 1 rule engine

In `src/lib/audit/layer1.ts` — runs FIRST, synchronous, all 93 rules:

```typescript
// src/lib/audit/layer1.ts

const RULES: Rule[] = loadRulesFromRegistry(); // parsed from rules.ts

function runLayer1(ctx: PackageContext): Finding[] {
  const findings: Finding[] = [];

  for (const module of ctx.modules) {
    const source = module.source || module.disassembly;

    for (const rule of RULES) {
      const matches = matchPattern(source, rule.pattern);

      for (const match of matches) {
        findings.push({
          rule_id: rule.id,
          severity: rule.severity,
          confidence: 1.0,          // deterministic = full confidence
          title: rule.description,
          description: rule.description,
          location: {
            module: module.name,
            function: extractFunctionName(match),
            line_start: match.lineStart,
            line_end: match.lineEnd,
          },
          impacted_code: match.snippet,
          recommendation: rule.recommendation,
          category: sectorToCategory(rule.sector),
          source: "layer1",
        });
      }
    }
  }

  return deduplicateFindings(findings);
}

// Dedup: same (rule_id, module, line_start) → keep one
function deduplicateFindings(findings: Finding[]): Finding[] {
  const seen = new Set<string>();
  return findings.filter(f => {
    const key = `${f.rule_id}:${f.location.module}:${f.location.line_start}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
```

- [ ] **The Cetus `checked_shlw` rule (`ML-INT-001`) always runs first regardless of order.**
- [ ] Implement the 65 REGEX rules first; AST rules (19) second; SKIP_MVP rules (9) are not implemented.
- [ ] `matchPattern` returns line numbers + snippet (compute via cumulative newline offsets).

### Task 2.3 — Layer 2 OZ DeFi math benchmark (10 rules)

In `src/lib/audit/layer2.ts` — deterministic, no model calls. OZ library: `openzeppelin/contracts-sui` v1.2.0 (`openzeppelin_math` + `openzeppelin_fp_math`).

**The 10 OZ rules (implement all):**

| Rule ID | OZ Safe Pattern | Dangerous Deviation | Severity |
|---|---|---|---|
| ML-OZ-001 | `u256::checked_shl(value, shift)` | Raw `<<` on u128/u256 OR `checked_shlw` with wrong mask `0xffffffffffffffff << 192` | Critical |
| ML-OZ-002 | `u<w>::checked_shr(value, shift)` | Raw `>>` on unsigned int without checked_shr | High |
| ML-OZ-003 | `u<w>::mul_div(a, b, denom, rounding)` | Direct `(a * b) / denom` without rounding param | High |
| ML-OZ-004 | `u<w>::mul_shr(a, b, shift, rounding)` | Direct `(a * b) >> shift` | High |
| ML-OZ-005 | `u<w>::average(a, b, rounding)` | `(a + b) / 2` without rounding control | Medium |
| ML-OZ-006 | `u<w>::inv_mod(value, modulus)` | Custom modular inverse loops or `mod_exp` | Medium |
| ML-OZ-007 | `u<w>::sqrt(value, rounding)` | Custom sqrt via loops/binary search | Low |
| ML-OZ-008 | `u<w>::log2/log10/log256(value, rounding)` | Custom log via loop shifting | Low |
| ML-OZ-009 | `UD30x9`/`SD29x9` fixed-point types | Raw `* 1000000000` or `/ 1000000000` on integers | High |
| ML-OZ-010 | `mul_div(value, percent, 100, rounding)` | `value * percent / 100` without explicit rounding | Medium |

```typescript
// src/lib/audit/layer2.ts

interface OzRule {
  id: string;           // ML-OZ-001 etc
  pattern: RegExp;      // regex detecting the deviation
  severity: Severity;
  ozSafePattern: string;
  description: string;
}

const OZ_RULES: OzRule[] = [
  {
    id: "ML-OZ-001",
    // Match: raw << on u256 OR wrong mask pattern
    pattern: /(\bu256\b[^;]*<<\s*\d+|0xffffffffffffffff\s*<<\s*192)/g,
    severity: "critical",
    ozSafePattern: "u256::checked_shl(value, shift)",
    description: "Unsafe bit-shift on u256 — use OZ checked_shl. (Cetus class: $223M exploit)",
  },
  // ... implement all 10 rules per the table above
];

function runLayer2(ctx: PackageContext): Finding[] {
  const findings: Finding[] = [];

  for (const module of ctx.modules) {
    const source = module.source || module.disassembly;

    for (const rule of OZ_RULES) {
      const matches = [...source.matchAll(rule.pattern)];

      for (const match of matches) {
        findings.push({
          rule_id: rule.id,
          severity: rule.severity,
          confidence: 0.95,        // OZ deviation = very high confidence
          title: rule.description,
          description: `Deviation from OZ safe pattern. Use: ${rule.ozSafePattern}`,
          location: extractLocation(source, match.index, module.name),
          impacted_code: match[0],
          recommendation: `Replace with OpenZeppelin Sui Math: ${rule.ozSafePattern}`,
          category: "integer_overflow",
          source: "layer2_oz",
        });
      }
    }
  }

  return findings;
}
```

- [ ] **ML-OZ-001 (Cetus-class) ALWAYS runs first. Its findings are always placed at the top of the report with `severity: "critical"`.**
- [ ] The wrong mask is `0xffffffffffffffff << 192` (only covers bits 192–255); the correct mask is `(1 << 192) - 1`. Detection must catch the wrong-mask pattern AND any raw `<< 64` on u256 outside `checked_shl`.

### Task 2.4 — Layer 3 engine integration (recall/remember hooks)

> The MemWal implementation itself is Phase 6 (F17/F18 — unchanged). This task only wires the hooks into the engine, against the `AuditMemory` interface (noop until Phase 6 lands).

```typescript
// In src/lib/audit/engine.ts — recall BEFORE Layer 1 runs

async function recallSimilarFindings(
  ctx: PackageContext,
  memory: AuditMemory
): Promise<MemoryHit[]> {
  // Build a summary of what the contract does for semantic search
  const contractSummary = summarizePackage(ctx); // module names + function signatures

  // Recall similar past findings from all 13 sectors
  const hits = await memory.recall(contractSummary, "movelens/all");
  return hits.slice(0, 5); // top 5 most similar
}

// After audit, remember new high-confidence findings
async function rememberFindings(
  findings: Finding[],
  memory: AuditMemory
): Promise<void> {
  const highConfidence = findings.filter(f => f.confidence >= 0.8);
  for (const f of highConfidence) {
    await memory.remember(f, `movelens/${f.category}`);
  }
}
```

- [ ] Recalled hits are injected as context into the Layer 4 few-shot prompt (see Task 2.7).
- [ ] `report.memory_context_used` reflects whether any recall hits were injected.

### Task 2.5 — LanceDB corpus seeding ⏭️ DEFERRED until Phases 1–5 green

In `scripts/seedLanceDB.ts`:

- [ ] `npm install @lancedb/lancedb` (pin exact version).
- [ ] Seed ~200 known-vulnerable Move snippets: the 93 corpus rules' pattern examples + real exploit code (Cetus `checked_shlw`, Pawtato admin cap forgery).

```typescript
// scripts/seedLanceDB.ts
// Run once to populate the vector store with known-vulnerable snippets
// from movelens_vuln_corpus_classified.md + real exploit code

import * as lancedb from '@lancedb/lancedb';
// Corpus: array of { name, code, sector, severity }
// name examples: "cetus_checked_shlw", "pawtato_admin_cap", "hot_potato_no_consume"
// Each snippet is embedded via the Python sidecar (/embed-raw) and stored in LanceDB:

const db = await lancedb.connect('./lancedb_store');
const rows = [];
for (const snippet of corpus) {
  const vec = await fetch(`${SIDECAR}/embed-raw`, { method: 'POST', body: JSON.stringify({ code: snippet.code }) })
    .then(r => r.json()).then(j => j.vector);   // 768-dim Jina embedding
  rows.push({ name: snippet.name, sector: snippet.sector, severity: snippet.severity, vector: vec, code: snippet.code });
}
await db.createTable('vuln_corpus', rows, { mode: 'overwrite' });
```

- [ ] LanceDB is embedded — no server, no Docker. `lancedb_store/` is gitignored.

### Task 2.6 — Layer 4 Python sidecar ⏭️ DEFERRED until Phases 1–5 green

In `scripts/layer4_server.py` + `requirements.txt` (`sentence-transformers, lancedb, flask, transformers, torch`):

**The 3 models (final decision, do not change):**
- **Model A — Embeddings (always runs):** `jinaai/jina-embeddings-v2-base-code` (161MB, 768-dim) via `sentence-transformers`, local. Cosine similarity > 0.75 against LanceDB → flag as similar to known vulnerability.
- **Model B — Classification (always runs after A):** `deepseek-ai/deepseek-coder-1.3b-instruct` (~1GB GGUF Q4_K_M) via `transformers` locally (Colab/Kaggle T4 if no local GPU). Outputs `{ vulnerable, category, confidence, reason }`.
- **Model C — Confirmation (ONLY when Model B confidence is 0.4–0.7):** Groq free tier `llama-3.3-70b-versatile` (or OpenRouter free `qwen/qwen3-coder:free`). Free, no credit card, ~30 RPM — Model C runs for only 20–30% of snippets so a demo never hits limits. **Skip if confidence > 0.7.**

```python
# scripts/layer4_server.py
# Runs as a local HTTP server on port 8765
# Next.js calls it via fetch('http://localhost:8765/embed') and /classify

from flask import Flask, request, jsonify
from sentence_transformers import SentenceTransformer
import lancedb, torch

app = Flask(__name__)

# Load models once at startup
embed_model = SentenceTransformer('jinaai/jina-embeddings-v2-base-code')
from transformers import pipeline
classify_model = pipeline('text-generation',
  model='deepseek-ai/deepseek-coder-1.3b-instruct',
  device=0 if torch.cuda.is_available() else -1
)

# LanceDB connection
db = lancedb.connect('./lancedb_store')
table = db.open_table('vuln_corpus')

@app.route('/embed', methods=['POST'])
def embed():
    code = request.json['code']
    vec = embed_model.encode(code).tolist()
    results = table.search(vec).limit(1).to_list()
    sim = results[0]['_distance'] if results else None
    return jsonify({ 'similar_to': results[0]['name'] if sim and sim > 0.75 else None })

@app.route('/classify', methods=['POST'])
def classify():
    prompt = request.json['prompt']
    out = classify_model(prompt, max_new_tokens=128, temperature=0.1)[0]['generated_text']
    import json, re
    match = re.search(r'\{.*\}', out, re.DOTALL)
    return jsonify(json.loads(match.group()) if match else { 'vulnerable': False, 'confidence': 0 })

if __name__ == '__main__':
    app.run(port=8765)
```

- [ ] Add an `/embed-raw` endpoint returning the raw 768-dim vector (used by seedLanceDB.ts) and a `/health` endpoint (used by init.sh).

### Task 2.7 — Layer 4 TypeScript caller ⏭️ DEFERRED until Phases 1–5 green

In `src/lib/audit/layer4.ts` — the ONLY file allowed to talk to the sidecar/Groq:

**Few-shot prompt template for Model B (use exactly this):**
```
You are a Sui Move smart-contract security classifier.
Move is resource-oriented: `has key`/`has store` = abilities; `acquires` = reads
global resource; capabilities (AdminCap) are access-control objects passed as params;
a "hot potato" struct has NO abilities and MUST be consumed in the same tx.
Overflow aborts EXCEPT on bit-shifts.

Classify the SNIPPET into exactly one category:
ML-ACC, ML-INT, ML-HOT, ML-OWN, ML-ARI, ML-UPG, ML-RAC, ML-RET,
ML-TOK, ML-WRP, ML-DOS, ML-DEP, ML-LOG.
If not vulnerable, set vulnerable: false.
Think step by step, then output ONLY JSON — no markdown, no explanation.

EXAMPLE 1:
let mask = 0xffffffffffffffff << 192;
if (n > mask) abort; let r = n << 64;
-> {"vulnerable": true, "category": "ML-INT", "confidence": 0.95, "reason": "Wrong overflow mask before <<64 (Cetus checked_shlw class)"}

EXAMPLE 2:
public fun create_admin_cap(_u: &UpgradeCap, to: address) { /* no package-id check */ }
-> {"vulnerable": true, "category": "ML-ACC", "confidence": 0.9, "reason": "Capability minted without validating UpgradeCap package ID (Pawtato class)"}

SNIPPET:
{code}

Output JSON only:
```

```typescript
// src/lib/audit/layer4.ts

async function runLayer4(
  ctx: PackageContext,
  memoryHits: MemoryHit[]
): Promise<Finding[]> {
  const findings: Finding[] = [];

  // Get suspicious snippets — functions not already flagged by Layer 1/2
  // with complex arithmetic or access control patterns
  const snippets = extractSuspiciousSnippets(ctx);

  for (const snippet of snippets) {
    // Step 1: Embed + similarity search (Model A via Python sidecar)
    const embedding = await embedSnippet(snippet.code);         // Jina local
    const simResult = await lanceDBSearch(embedding, 0.75);     // LanceDB

    // Step 2: Classify (Model B via local transformers)
    const prompt = buildFewShotPrompt(snippet.code, memoryHits); // recalled findings = extra few-shot context
    const classResult = await classifySnippet(prompt);          // DeepSeek local
    // classResult = { vulnerable, category, confidence, reason }

    if (!classResult.vulnerable && !simResult) continue;

    let finalConfidence = classResult.confidence;

    // Boost if similarity match found
    if (simResult) finalConfidence = Math.min(1.0, finalConfidence + 0.2);

    // Step 3: Confirmation (Model C) — only for uncertain range
    if (finalConfidence >= 0.4 && finalConfidence <= 0.7) {
      const confirmed = await confirmWithGroq(snippet.code, classResult.category);
      finalConfidence = confirmed ? finalConfidence + 0.1 : finalConfidence - 0.1;
    }

    if (finalConfidence < 0.35) continue; // below threshold, skip

    findings.push({
      rule_id: `${classResult.category}-L4-001`,  // Layer 4 finding marker
      severity: confidenceToSeverity(finalConfidence),
      confidence: finalConfidence,
      title: `[Layer 4] ${classResult.reason}`,
      description: classResult.reason,
      location: snippet.location,
      impacted_code: snippet.code,
      recommendation: getRuleRecommendation(classResult.category),
      category: sectorToCategory(classResult.category),
      similar_to: simResult?.name || null,
      source: "layer4",
    });
  }

  return findings;
}

// Score merging formula (final confidence)
// finalConfidence = clamp(classResult.confidence + (simResult ? 0.2 : 0) + (groqConfirmed ? 0.1 : 0), 0, 1)
```

### Task 2.8 — Engine orchestrator (runs all 4 layers)

In `src/lib/audit/engine.ts`:

```typescript
// src/lib/audit/engine.ts

export async function runAudit(ctx: PackageContext, memory: AuditMemory): Promise<AuditReport> {
  const layersRun: string[] = [];

  // LAYER 3 (recall) — before anything else
  const memoryHits = await recallSimilarFindings(ctx, memory);   // [] from noop stub
  if (memoryHits.length > 0) layersRun.push("layer3_recall");

  // LAYER 1 — deterministic rules (synchronous, runs first; ML-INT-001 first within it)
  const l1 = runLayer1(ctx);              layersRun.push("layer1");

  // LAYER 2 — OZ benchmark (ML-OZ-001 first within it)
  const l2 = runLayer2(ctx);              layersRun.push("layer2");

  // LAYER 4 — model ensemble (ONLY if sidecar healthy; never blocks the audit)
  let l4: Finding[] = [];
  if (await sidecarHealthy()) {
    l4 = await runLayer4(ctx, memoryHits); layersRun.push("layer4");
  } else {
    console.warn("Layer 4 sidecar unavailable — continuing with Layers 1–3 only");
  }

  // MERGE: dedupe (rule_id, module, line_start) keep highest confidence;
  // SORT: Cetus-class (ML-INT-001 / ML-OZ-001) absolute top, then severity, then confidence desc
  const findings = sortFindings(mergeAndDedupe([...l1, ...l2, ...l4]));

  // LAYER 3 (remember) — store high-confidence findings back
  await rememberFindings(findings, memory);

  return assembleReport(ctx, findings, { memoryHits, layersRun }); // Phase 3, Task 3.1
}
```

- [ ] Whole-audit budget: 90s for all 4 layers on a fixture. Layers 1+2 alone must complete in < 5s.
- [ ] A Layer 4 failure must NEVER kill the audit — log and continue with Layers 1–3 findings.

## Phase 2 — Verify

- [ ] Run engine against all 4 fixtures: every rule_id in each `expected.json` appears; `clean.move` yields no critical/high.
- [ ] `overflow.move` → ML-INT-001 and/or ML-OZ-001 fires, severity critical, sorted FIRST in the report.
- [ ] Layers 1+2 alone complete in < 5s on a fixture; full 4-layer run < 90s.
- [ ] Every emitted finding validates against the zod schema; zero unknown rule_ids in output.
- [ ] `grep -ri "anthropic\|openai_api_key\|callClaude" src/` returns ZERO matches.

---

# PHASE 3 — Report Assembly + Seal Encryption

**Phase goal:** A complete `AuditReport` JSON, encrypted with Seal so the contract owner gets a private draft first.

### Task 3.1 — Report assembler

In `src/lib/audit/engine.ts` (extend):

- [ ] Compose the final `AuditReport`: findings sorted Cetus-class first, then severity (critical→info), then confidence desc.
- [ ] Summary block: counts per severity, overall risk grade (A–F: F if any critical, D if ≥2 high, C if 1 high, B if mediums only, A if low/info only — document the exact mapping in code comments).
- [ ] Watermark field is hardcoded — not configurable.

**Pseudocode:**
```typescript
function assembleReport(ctx, findings, meta): AuditReport {
  return AuditReport.parse({
    report_id: crypto.randomUUID(),
    package: summarize(ctx),                       // id, mvrName, version, module count
    findings,
    memory_context_used: meta.memoryHits.length > 0,
    layers_run: meta.layersRun,
    watermark: "Automated pre-screen — not a substitute for a human audit.",
    generated_at: new Date().toISOString(),
    engine_version: ENGINE_VERSION,                // bump on rule changes
  });
}

function riskGrade(findings): "A"|"B"|"C"|"D"|"F" {
  const c = countBySeverity(findings);
  if (c.critical > 0) return "F";
  if (c.high >= 2)   return "D";
  if (c.high === 1)  return "C";
  if (c.medium > 0)  return "B";
  return "A";
}
```

### Task 3.2 — Seal encryption wrapper

In `src/lib/seal/encrypt.ts`:

- [ ] `npm install @mysten/seal` (pin exact version).
- [ ] Threshold-encrypt the serialized report with an identity-based policy keyed to the package owner per https://seal.mystenlabs.com docs.
- [ ] **MVP fallback rule:** if Seal testnet key servers are unreachable, fall back to plaintext + loud warning + `sealed: false` in metadata. The demo must never hard-fail on Seal availability. (Feature `F12` only passes with REAL Seal encryption working.)

**Pseudocode:**
```typescript
// src/lib/seal/encrypt.ts
import { SealClient } from "@mysten/seal";  // verify exact API in docs at implementation time

export async function encryptReport(
  report: AuditReport,
  ownerAddress: string
): Promise<{ encryptedBytes: Uint8Array; sealId: string; sealed: boolean }> {
  const plaintext = new TextEncoder().encode(JSON.stringify(report));
  try {
    const client = new SealClient({ network: env.WALRUS_NETWORK /* key server config */ });
    const { encryptedObject, id } = await client.encrypt({
      data: plaintext,
      identity: ownerAddress,        // identity-based policy: owner decrypts first
      threshold: 2,                  // t-of-n key servers, per Seal docs
    });
    return { encryptedBytes: encryptedObject, sealId: id, sealed: true };
  } catch (e) {
    console.warn("SEAL UNAVAILABLE — storing PLAINTEXT (sealed=false). Demo fallback only.", e);
    return { encryptedBytes: plaintext, sealId: "unsealed", sealed: false };
  }
}
```

### Phase 3 — Verify

- [ ] Encrypted bytes are not valid JSON (actually encrypted, spot-check).
- [ ] Decryption round-trip with the owner identity recovers a byte-identical report.
- [ ] Report JSON contains the watermark string verbatim.

---

# PHASE 4 — Walrus Storage (Quilt + Blob)

**Phase goal (CORE TRACK REQUIREMENT):** report bundle stored permanently on Walrus, blob ID returned.

### Task 4.1 — Quilt bundler

In `src/lib/walrus/quilt.ts`:

- [ ] `npm install @mysten/walrus` (pin exact version).
- [ ] Bundle three entries: `report.json` (PUBLIC metadata only: package id, mvr name, severity counts, risk grade, watermark, sealed flag — never decrypted findings), `findings.enc` (Seal-encrypted full report), `summary.md` (human-readable public summary).

**Pseudocode:**
```typescript
// src/lib/walrus/quilt.ts
export function buildQuilt(report: AuditReport, encryptedBytes: Uint8Array, sealed: boolean): QuiltEntry[] {
  const publicMeta = {
    package_id: report.package.packageId,
    mvr_name: report.package.mvrName,
    severity_counts: countBySeverity(report.findings),
    risk_grade: riskGrade(report.findings),
    watermark: report.watermark,
    sealed,
    generated_at: report.generated_at,
  };
  return [
    { identifier: "report.json",  contents: utf8(JSON.stringify(publicMeta)) },
    { identifier: "findings.enc", contents: encryptedBytes },
    { identifier: "summary.md",   contents: utf8(renderSummaryMd(publicMeta)) },
  ];
}
```

### Task 4.2 — Blob upload

In `src/lib/walrus/upload.ts`:

- [ ] Upload via the Walrus TS SDK quilt flow against **testnet**, signing with `SUI_KEYPAIR_B64`, `epochs: 5`. Retry once on failure; typed `WalrusUploadError`.
- [ ] `fetchAuditBlob(blobId)` — read-back helper used by Verify + the frontend.

**Pseudocode:**
```typescript
// src/lib/walrus/upload.ts
import { WalrusClient } from "@mysten/walrus";   // verify exact API in docs at implementation time

export async function uploadAuditQuilt(
  entries: QuiltEntry[]
): Promise<{ blobId: string; quiltPatchIds: Record<string, string> }> {
  const client = new WalrusClient({ network: env.WALRUS_NETWORK, suiClient });
  const signer = keypairFromB64(env.SUI_KEYPAIR_B64);
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const result = await client.writeQuilt({ blobs: entries, epochs: 5, deletable: false, signer });
      return { blobId: result.blobId, quiltPatchIds: mapPatchIds(result) };
    } catch (e) {
      if (attempt === 2) throw new WalrusUploadError("Walrus upload failed after retry", { cause: e });
    }
  }
  throw new Error("unreachable");
}

export async function fetchAuditBlob(blobId: string): Promise<Map<string, Uint8Array>> {
  // read quilt back by blobId via SDK / aggregator, return identifier → bytes
}
```

### Phase 4 — Verify

- [ ] Run a fixture audit end-to-end → upload → real blob ID returned (log it in progress.txt).
- [ ] Fetch the blob back by ID from a fresh process; `report.json` parses and matches what was uploaded.
- [ ] Blob ID is reproducibly retrievable after several minutes (permanence spot-check).

---

# PHASE 5 — MVR On-Chain Linking

**Phase goal:** `set_metadata()` attaches the Walrus blob ID to the audited package's MVR record — the audit becomes part of the package's permanent identity.

### Task 5.1 — Metadata transaction

In `src/lib/mvr/metadata.ts`:

- [ ] `attachAuditToPackage(packageInfoId, blobId)` — PTB calling MVR's `set_metadata` with key `"movelens_audit"` and value = the Walrus blob ID, per https://docs.suins.io/move-registry/managing-package-info. Sign with the env keypair.
- [ ] **Reality constraint:** only the holder of a package's `PackageInfo` object can set its metadata. For the demo: publish our OWN tiny test package (the `move/` module, ≤150 lines — a trivial `movelens_demo` module), register it in MVR testnet, and attach audit metadata to THAT. Document this clearly in code comments and the report page.
- [ ] `readAuditMetadata(packageInfoId)` — GraphQL read-back of the metadata field.

**Pseudocode:**
```typescript
// src/lib/mvr/metadata.ts
import { Transaction } from "@mysten/sui/transactions";

export async function attachAuditToPackage(packageInfoId: string, blobId: string): Promise<string> {
  const tx = new Transaction();
  tx.moveCall({
    target: `${MVR_PACKAGE}::package_info::set_metadata`,   // verify exact target in MVR docs
    arguments: [tx.object(packageInfoId), tx.pure.string("movelens_audit"), tx.pure.string(blobId)],
  });
  const result = await suiClient.signAndExecuteTransaction({ transaction: tx, signer: keypair });
  return result.digest;
}

export async function readAuditMetadata(packageInfoId: string): Promise<string | null> {
  // GraphQL object query on PackageInfo → metadata VecMap → value for "movelens_audit"
}
```

### Phase 5 — Verify

- [ ] On testnet: run audit on our demo package → upload to Walrus → `attachAuditToPackage` succeeds → `readAuditMetadata` returns the same blob ID.
- [ ] Tx digest logged in progress.txt as proof.

---

# PHASE 6 — MemWal Agent Memory (= Layer 3 implementation)

**Phase goal:** the auditor remembers — past finding patterns improve future audits. (Engine hooks already wired in Task 2.4.)

### Task 6.1 — Abstraction layer FIRST

In `src/lib/memory/index.ts`:

```typescript
export interface MemoryHit { finding: Finding; similarity: number; namespace: string; }

export interface AuditMemory {
  recall(query: string, namespace: string): Promise<MemoryHit[]>;  // semantic search
  remember(finding: Finding, namespace: string): Promise<void>;
  healthy(): Promise<boolean>;
}

export async function createMemory(): Promise<AuditMemory> {
  if (env.MEMWAL_ENABLED) {
    const memwal = new MemWalMemory();
    if (await memwal.healthy()) return memwal;
    console.warn("MemWal unhealthy — falling back to noop memory");
  }
  return new NoopMemory();   // recall → [], remember → no-op
}
// Business logic NEVER knows which implementation it got.
```

### Task 6.2 — MemWal implementation

In `src/lib/memory/memwal.ts`:

- [ ] `npm install @mysten-incubation/memwal@<EXACT_PINNED_VERSION>` — no `^`/`~`.
- [ ] Implement per https://docs.wal.app/walrus-memory/sdk/api-reference. Namespaces: `movelens/<category>` plus the cross-sector `movelens/all`.
- [ ] Engine integration is already wired (Task 2.4): recall before Layer 1, top-5 hits into Layer 4 few-shot context, remember findings with `confidence ≥ 0.8` after.

### Phase 6 — Verify

- [ ] Audit fixture A → remember fires (verify via MemWal read). Audit a similar fixture → recall returns the stored pattern (log it).
- [ ] Set `MEMWAL_ENABLED=false` → entire pipeline still works end-to-end with the noop stub, `memory_context_used: false`.

---

# PHASE 7 — Frontend (Next.js 15)

**Phase goal:** the judge-facing surface. Product & UX = 20% of score.

### Task 7.1 — Audit API routes

- [ ] `POST /api/audit` → validates input (Task 1.4), creates job, kicks off pipeline async, returns `{ auditId }`.
- [ ] `GET /api/audit?id=` → current job status (frontend polls every 2s).
- [ ] `GET /api/report/[id]` → finished report JSON (public parts) + blobId + tx digest + MVR name.

**Pseudocode:**
```typescript
// src/store/audits.ts
type AuditStatus = "queued" | "fetching" | "auditing" | "encrypting"
                 | "uploading" | "linking" | "done" | "failed";

interface AuditJob {
  id: string; status: AuditStatus;
  report?: AuditReport; blobId?: string; txDigest?: string; error?: string;
}
const jobs = new Map<string, AuditJob>();   // in-process, no DB for MVP

// src/app/api/audit/route.ts
export async function POST(req: Request) {
  const input = await validateInput(req);            // Task 1.4 rules
  const job = createJob();
  void runPipeline(job, input);                       // async, updates job.status per stage
  return Response.json({ auditId: job.id });
}

async function runPipeline(job: AuditJob, input: AuditInput) {
  try {
    job.status = "fetching";   const ctx = await buildPackageContext(input);     // Phase 1
    job.status = "auditing";   const memory = await createMemory();
                               const report = await runAudit(ctx, memory);       // Phase 2 (4 layers)
    job.status = "encrypting"; const sealed = await encryptReport(report, owner);// Phase 3
    job.status = "uploading";  const { blobId } = await uploadAuditQuilt(buildQuilt(report, sealed.encryptedBytes, sealed.sealed)); // Phase 4
    job.status = "linking";    job.txDigest = await tryAttachToMvr(blobId);      // Phase 5, demo pkg only
    job.status = "done";       job.report = report; job.blobId = blobId;
  } catch (e) {
    job.status = "failed"; job.error = humanReadable(e);
  }
}
```

### Task 7.2 — Landing page

In `src/app/page.tsx`:

- [ ] Hero with one-line pitch, input for a Sui package address, tab to paste Move source, network selector (testnet default), "Run Audit" button.
- [ ] Client-side address validation (0x + hex) before submit. On submit → route to `/audit/[id]`.

### Task 7.3 — Report page

In `src/app/audit/[id]/page.tsx`:

- [ ] Live pipeline stepper while running — show the architecture steps with the current one animated (this *is* the demo). Include a "4-layer engine" sub-stepper during the `auditing` stage (Layer 1 → 2 → 3 → 4).
- [ ] Finished state: risk grade badge, severity count chips, MVR name when resolved, findings grouped by severity — each expandable: description, impacted code (monospace), line range, recommendation, confidence bar, `rule_id` tag, layer source badge (`layer1`/`layer2_oz`/`layer4`), `similar_to` exploit name when present.
- [ ] Permanent-trust panel: Walrus blob ID (link to aggregator URL), Seal "encrypted draft" badge, MVR tx digest (Sui explorer link).
- [ ] Watermark visibly rendered at the top of every report.

### Phase 7 — Verify

- [ ] In a real browser: paste fixture source → watch stepper → report renders with findings, blob ID, watermark. No console errors.
- [ ] Invalid address shows inline validation error, no API call fired.
- [ ] Hard-refresh the report page mid-audit → state recovers from polling.

---

# PHASE 8 — Polish + Demo Readiness

### Task 8.1 — Failure honesty pass

- [ ] Every pipeline stage failure surfaces a human-readable error on the report page (no infinite spinners).
- [ ] Confidence scores rendered on every finding; findings with confidence < 0.4 visually de-emphasized and labeled "low confidence".

### Task 8.2 — Demo script assets

- [ ] `scripts/demo.md`: exact 3-minute demo flow — which package to paste, what to point at (Walrus blob ID, MVR tx, Seal badge, the 4-layer engine animation, the Cetus-class detection), mapped to judging criteria (Real-World 50% / UX 20% / Technical 20% / Vision 10%).
- [ ] Pre-run one full audit and record its blobId + tx digest in `demo.md` as backup if live infra flakes during judging.

### Task 8.3 — README

- [ ] Root `README.md`: pitch, architecture diagram, the 4-layer engine explanation (a judge-facing differentiator: "zero-cost deterministic-first security engine"), tech stack with Walrus/Seal/MVR/MemWal callouts, setup instructions, demo video placeholder.

### Phase 8 — Verify

- [ ] A full cold run: fresh clone → `cp .env.example .env` (fill keys) → `pip install -r requirements.txt` (only if Layer 4 enabled) → `./init.sh` → audit a fixture → report with blob ID, in under 5 minutes of human effort.

---

# CROSS-CUTTING ENGINEERING PRINCIPLES

- [ ] **Zero paid APIs is non-negotiable.** `grep -ri "anthropic\|openai_api_key\|callClaude" src/` must always return zero. Groq/OpenRouter free tiers are the only permitted external model calls, and only from `layer4.ts`.
- [ ] **Deterministic-first.** Layers 1+2 (confidence 1.0/0.95) are the engine's backbone; model layers only add, never replace.
- [ ] **Anti-hallucination is non-negotiable.** rules.ts registry is the only source of truth; unknown ids are dropped, never invented. Confidence on every finding. Watermark on every report.
- [ ] **GraphQL only.** Any JSON-RPC usage is a build-breaking bug.
- [ ] **Abstraction over beta SDKs.** MemWal behind `memory/index.ts`, Layer 4 behind `layer4.ts`, Seal behind `seal/encrypt.ts`. The demo must survive any single external service being down.
- [ ] **Schema-first.** zod schemas are the contract between pipeline stages.
- [ ] **The pipeline is the product.** On-chain Move stays tiny; TypeScript does the work.
