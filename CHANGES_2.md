# MoveLens — CHANGES_2.md (Round 3 Polish — Final 7 Days)

> **Source:** Consolidated from two independent Opus 4.7 reviews (Report 2 + Report 3, June 2026)
> **Current state:** 34/35 features passing. F18 (MemWal mainnet) permanently deferred.
> **No new feature IDs.** This is a cleanup/hardening pass on existing, already-passing features.
> Each task below is verified manually (no features.json changes) — but Claude Code should
> still run the Verify steps and report results in progress.txt after each task.
>
> **How to use:** Same as before. One task per session.
> `"Read CLAUDE.md, then read CHANGES_2.md, and start with Task D1."`
> Then `"Start D2"`, `"Start D3"`, etc. in order.

---

# TASK MAP (this file only)

```
D1 → Core engine hardening: sanitize, confidence recalibration, parallelize Layer 4, severity floor
D2 → Memory wiring + privacy quick fix + init.sh checks
D3 → Gallery overhaul + Cetus homepage hero
D4 → Demo fallback + SECURITY.md + PRIVACY.md
D5 → README business model paragraph + patch before/after snippets
```

**Priority order: D1 → D2 → D3 → D4 → D5** (matches the 5-day schedule, ~2.5h each).
**Do NOT skip ahead or combine tasks** — each touches files used by later tasks.

---

# TASK D1 — Core Engine Hardening

**Goal:** Fix four real bugs found by both reviews: (1) Layer 1 regexes and Layer 4 see raw
comments/strings causing false positives, (2) Layer 4 confidence almost never lands in the
Groq-confirmation range, (3) Layer 4 runs snippets serially causing the 90s budget to blow
past 110s, (4) Layer 4 can silently downgrade a Layer 1 critical finding.

## D1.1 — Central `sanitizeForPatterns()`

**New file:** `src/lib/audit/sanitize.ts`

```typescript
// src/lib/audit/sanitize.ts
// Strips Move comments AND string literals before pattern matching.
// Used by Layer 1 (regex rules) and Layer 4 (sent to sidecar for embedding/classification).
// Fixes: ML-ACC-001 cross-comment bypass, ML-INT-004 comment-slash false positive,
// ML-UPG-004 "UpgradeCap" in comment false positive (Sessions 7-8).

export function sanitizeForPatterns(source: string): string {
  let out = source;

  // 1. Remove block comments /* ... */ (including doc comments /** */)
  out = out.replace(/\/\*[\s\S]*?\*\//g, "");

  // 2. Remove line comments // ... and doc comments /// ...
  //    (/// is just // followed by /, the regex already covers it)
  out = out.replace(/\/\/[^\n]*/g, "");

  // 3. Remove Move string literals (including byte strings b"...")
  //    Handles escaped quotes \" inside the string.
  out = out.replace(/b?"(?:[^"\\]|\\.)*"/g, '""');

  return out;
}
```

## D1.2 — Apply sanitize in Layer 1 and before Layer 4 sidecar calls

```typescript
// src/lib/audit/layer1.ts — in runLayer1():
// BEFORE: const source = module.source || module.disassembly;
// AFTER:
import { sanitizeForPatterns } from "./sanitize";

const rawSource = module.source || module.disassembly;
const source = sanitizeForPatterns(rawSource);
// Line numbers: matchPattern must compute line numbers against rawSource
// (sanitized text has different line lengths where comments were removed).
// Fix: sanitize line-by-line, preserving line count —
// replace stripped content with same-length whitespace, NOT empty string,
// so line numbers stay aligned. Update sanitizeForPatterns to optionally
// preserve line structure:

export function sanitizeForPatterns(source: string, preserveLines = false): string {
  // ... same replacements, but if preserveLines, replace matched
  // content with a same-length run of spaces (keep \n characters intact)
  // so line_start/line_end calculations remain correct.
}
```

```typescript
// src/lib/audit/layer4.ts — in extractSuspiciousSnippets() and before embed/classify calls:
import { sanitizeForPatterns } from "./sanitize";

// When building the snippet.code that gets sent to the sidecar:
const cleanCode = sanitizeForPatterns(rawSnippetCode, false); // line preservation not needed here
// Send cleanCode to embedSnippet() and classifySnippet(), NOT rawSnippetCode.
```

```python
# scripts/layer4_server.py — _strip_move_comments() can now be REMOVED entirely
# since sanitization happens on the TypeScript side before the request arrives.
# Keep _strip_move_comments as a defense-in-depth fallback (call it on
# received `code` too, in case a future caller forgets to sanitize).
```

## D1.3 — Confidence recalibration (so Groq gate actually fires)

```python
# scripts/layer4_server.py — in _call_ollama(), fix the confidence default:

# BEFORE:
#   "confidence": float(parsed.get("confidence", 0.5)),

# AFTER — when the model omits confidence, default into the Groq-gate range
# instead of a high-confidence guess:
raw_confidence = parsed.get("confidence")
if raw_confidence is None:
    # Model didn't provide a confidence score — assume uncertain,
    # let Model C (Groq) make the final call.
    confidence = 0.55 if parsed.get("vulnerable", False) else 0.15
else:
    confidence = float(raw_confidence)

return {
    "vulnerable": bool(parsed.get("vulnerable", False)),
    "category":   str(parsed.get("category", "ML-LOG")),
    "severity":   "critical" if confidence > 0.85 else
                  "high"     if confidence > 0.70 else "medium",
    "confidence": confidence,
    "reason":     str(parsed.get("reason", "Classified by DeepSeek-1.3B")),
}
```

```typescript
// src/lib/audit/layer4.ts — also recalibrate the similarity boost so it
// doesn't push everything straight to "critical":

// BEFORE: confidence = Math.min(1.0, confidence + (simResult.similar_to ? 0.2 : 0));
// AFTER — smaller boost, and only if base confidence was already moderate:
if (simResult.similar_to && confidence < 0.8) {
  confidence = Math.min(0.95, confidence + 0.15);
}
```

## D1.4 — Parallelize Layer 4 snippets

```typescript
// src/lib/audit/layer4.ts — runLayer4(): replace the serial for...of loop
// with batches of 4 processed via Promise.all.

// BEFORE:
// for (const snippet of snippets) { ... await embedSnippet ... await classifySnippet ... }

// AFTER:
const BATCH_SIZE = 4;
const findings: Finding[] = [];

for (let i = 0; i < snippets.length; i += BATCH_SIZE) {
  const batch = snippets.slice(i, i + BATCH_SIZE);
  const batchResults = await Promise.all(
    batch.map(snippet => analyzeSnippet(snippet, memoryHits)) // extract the per-snippet body into analyzeSnippet()
  );
  for (const result of batchResults) {
    if (result) findings.push(result);
  }
}

// analyzeSnippet(snippet, memoryHits): Promise<Finding | null>
// — contains the existing per-snippet logic (embed, classify, groq confirm, assemble).
// Must NOT throw — catch internally and return null on any error (existing behavior).
```

- [ ] **Expected impact:** 20 snippets at ~2-3s each serially = 40-60s. Batches of 4 in
  parallel ≈ 5 batches × ~3s = ~15s. Brings total audit time from ~110s back under 90s.

## D1.5 — Category→severity floor map

```typescript
// src/lib/audit/engine.ts — in mergeAndDedupe(), add a floor check:
// Prevents Layer 4 from silently downgrading a Layer 1/Layer 2 finding
// for the same (rule_id_sector, module, line) to a lower severity.

const SEVERITY_RANK: Record<Severity, number> = {
  critical: 4, high: 3, medium: 2, low: 1, info: 0,
};

const CATEGORY_SEVERITY_FLOOR: Record<string, Severity> = {
  // sector prefix → minimum severity any finding in this sector can have
  "ML-INT": "high",   // integer overflow / bitwise — never below high
  "ML-OZ":  "high",   // OZ math deviations — never below high
  "ML-ACC": "medium", // access control — never below medium
};

function applySeverityFloor(finding: Finding): Finding {
  const sector = finding.rule_id.split("-").slice(0, 2).join("-"); // e.g. "ML-INT"
  const floor = CATEGORY_SEVERITY_FLOOR[sector];
  if (floor && SEVERITY_RANK[finding.severity] < SEVERITY_RANK[floor]) {
    return { ...finding, severity: floor };
  }
  return finding;
}

// In mergeAndDedupe(), apply applySeverityFloor() to every finding BEFORE
// the dedup-by-key step (so the floor is applied regardless of source layer).
```

## Task D1 — Verify

- [ ] Create a test snippet: `// AdminCap check here\npublic fun drain(ctx: &mut TxContext) { ... }`
      Run Layer 1 — verify ML-ACC-001 STILL fires (comment no longer suppresses it)
- [ ] Run Layer 1 on `clean.move` — verify ML-INT-004 and ML-UPG-004 false positives from
      comments are GONE (re-check against Session 8's documented false positives)
- [ ] Run Layer 4 on overflow.move — verify at least one finding has `confidence` in 0.4-0.7
      range AND Groq is called (check logs for "Groq confirmation for...")
- [ ] Time a full audit on the Cetus fixture (or overflow.move) — verify total runtime < 90s,
      and specifically Layer 4 alone < 20s
- [ ] Manually craft a case where Layer 1 finds ML-INT-001 (critical) and Layer 4 also finds
      something at the same module/line with a lower severity — verify final merged finding
      keeps `severity: "critical"` (or "high" floor for ML-INT sector)

---

# TASK D2 — Memory Wiring + Privacy Quick Fix + init.sh

**Goal:** Make Layer 3 recall actually feed Layer 4 (the "learning auditor" story), fix the
LanceDB corpus pollution bug, stop leaking `mvr_name` in public metadata, and extend init.sh
to catch the gaps both reviews found.

## D2.1 — Wire `recall()` into Layer 4 prompt

```typescript
// src/lib/audit/engine.ts — in runAudit(), BEFORE Layer 4 runs:

// BEFORE: const memoryHits = await recallSimilarFindings(ctx, memory); // called with ""
// AFTER — build a real query from the package's suspicious code:

async function buildRecallQuery(ctx: PackageContext): Promise<string> {
  // Use the first ~500 chars of the first module's source as the recall query.
  // (Simple heuristic — good enough for corpus similarity search.)
  const firstModule = ctx.modules[0];
  const src = firstModule?.source || firstModule?.disassembly || "";
  return sanitizeForPatterns(src).slice(0, 500);
}

const recallQuery = await buildRecallQuery(ctx);
const memoryHits = await memory.recall(recallQuery, "movelens/all");
// memoryHits now contains real LanceDB similarity results (not empty)
```

```typescript
// src/lib/audit/layer4.ts — runLayer4(ctx, memoryHits) already receives memoryHits
// (was previously unused — eslint-disable comment can be removed).
// Use it to build a few-shot addendum sent to the sidecar:

function buildMemoryContext(memoryHits: MemoryHit[]): string {
  if (memoryHits.length === 0) return "";
  const examples = memoryHits.slice(0, 2).map(hit =>
    `KNOWN SIMILAR PATTERN: "${hit.similar_to}" (similarity ${hit.score.toFixed(2)})`
  ).join("\n");
  return `\n\nADDITIONAL CONTEXT FROM PAST AUDITS:\n${examples}\n`;
}

// In classifySnippet() call, pass the memory context as an extra field:
const resp = await fetch(`${SIDECAR}/classify`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    code: cleanCode,
    memory_context: buildMemoryContext(memoryHits), // NEW field
  }),
  signal: AbortSignal.timeout(15_000),
});
```

```python
# scripts/layer4_server.py — /classify endpoint: append memory_context to the prompt

@app.route("/classify", methods=["POST"])
def classify():
    body = request.get_json(force=True, silent=True) or {}
    code = body.get("code", "")
    memory_context = body.get("memory_context", "")  # NEW

    clean_code = _strip_move_comments(code)  # defense-in-depth, see D1.2
    result = heuristic_classify(clean_code, memory_context)  # pass through
    return jsonify(result)

# In heuristic_classify() / _call_ollama(), append memory_context to the prompt:
def _call_ollama(code: str, memory_context: str = "") -> dict | None:
    prompt = DEEPSEEK_PROMPT_TEMPLATE.format(code=code[:600]) + memory_context
    # ... rest unchanged
```

- [ ] Set `report.memory_hits_count = memoryHits.length` on the AuditReport (already added
      the field in F31 — just make sure it now reflects the REAL count from the real query).

## D2.2 — Fix `/remember` to store code, not description

```typescript
// src/lib/memory/lancedb-memory.ts — in remember():

// BEFORE: code: finding.description  (or similar — sends natural-language text)
// AFTER:
async remember(finding: Finding, namespace: string): Promise<void> {
  const codeToStore = finding.impacted_code ?? null;
  if (!codeToStore) return; // nothing useful to store — skip silently

  try {
    await fetch(`${SIDECAR_URL}/remember`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code:       codeToStore,                                    // ACTUAL CODE, not description
        name:       `audit_finding_${finding.rule_id}_${Date.now()}`,
        sector:     finding.rule_id.split("-").slice(0, 2).join("-"),
        severity:   finding.severity,
        from_audit: true,
        namespace,
      }),
      signal: AbortSignal.timeout(8000),
    });
  } catch { /* never block the audit */ }
}
```

## D2.3 — Drop plaintext `mvr_name` from public metadata

```typescript
// src/lib/walrus/quilt.ts — in buildQuilt(), in publicMeta:

// BEFORE:
//   mvr_name: report.package.mvrName,

// AFTER — only include mvr_name if the user explicitly opted into on-chain publish
// (reuse the publishOnChain flag from F32):
const publicMeta = {
  package_ref: saltedPackageHash(report.package.packageId),
  mvr_name: report.publishOnChain ? report.package.mvrName : null, // gated
  severity_counts: countBySeverity(report.findings),
  risk_grade: riskGrade(report.findings),
  watermark: report.watermark,
  sealed,
  generated_at: report.generated_at,
};
```

```typescript
// src/lib/audit/schema.ts — add publishOnChain to AuditReport if not already present:
// publishOnChain: z.boolean().default(false),
// Set this from the API route input when assembling the report (Task 3.1 / engine.ts).
```

```markdown
// src/lib/walrus/quilt.ts — in summary.md rendering (renderSummaryMd):
// If mvr_name is null, the package reference line should read:
//   "Package: [private — audit available to owner only]"
// instead of showing the hash prefix (avoids the "16-char hash is enumerable" issue
// from Report 3 Gap 2 — simplest fix is just don't show ANY reference when not opted in).
```

## D2.4 — init.sh additions

```bash
# init.sh — add to step 8 (or a new step 9), per both reviews:

step "9/9 Layer 3/4 readiness + gallery validity"

# Ollama model check (not just port — verify the model is pulled)
if command -v ollama >/dev/null 2>&1; then
  if ollama list 2>/dev/null | grep -q "deepseek-coder"; then
    ok "deepseek-coder model available in Ollama"
  else
    bad "deepseek-coder:1.3b not pulled — run: ollama pull deepseek-coder:1.3b"
  fi
fi

# LanceDB corpus size check via sidecar /health
if curl -s http://localhost:8765/health 2>/dev/null | grep -q '"corpus_rows"'; then
  ROWS=$(curl -s http://localhost:8765/health | node -e "process.stdin.once('data',d=>console.log(JSON.parse(d).corpus_rows))")
  if [ "$ROWS" -ge 50 ] 2>/dev/null; then
    ok "LanceDB corpus has $ROWS rows (>= 50)"
  else
    bad "LanceDB corpus has only $ROWS rows (< 50) — run scripts/seedLanceDB.ts"
  fi
fi

# TypeScript check (if not already covered)
if [ -f package.json ]; then
  npx tsc --noEmit && ok "tsc --noEmit clean" || bad "tsc --noEmit FAILED"
fi

# Gallery validity
if [ -f src/app/gallery.json ]; then
  node -e "JSON.parse(require('fs').readFileSync('src/app/gallery.json','utf8'))" \
    && ok "gallery.json valid JSON" || bad "gallery.json INVALID JSON"
else
  bad "src/app/gallery.json missing"
fi
```

## Task D2 — Verify

- [ ] Run an audit where the corpus contains a Cetus-like pattern; verify
      `report.memory_hits_count > 0` AND the Layer 4 sidecar log shows
      "ADDITIONAL CONTEXT FROM PAST AUDITS" was included in the prompt
- [ ] Run an audit with a high-confidence finding; check LanceDB afterward —
      verify the new row's `code` field contains actual Move code, not a
      "[Layer 4] Similar to..." description string
- [ ] Build a quilt with `publishOnChain: false` — verify `report.json` has
      `mvr_name: null` and summary.md shows "[private — audit available to owner only]"
- [ ] Build a quilt with `publishOnChain: true` — verify `mvr_name` appears correctly
- [ ] Run `./init.sh` — verify the new step 9 checks all pass (or correctly report
      what's missing)

---

# TASK D3 — Gallery Overhaul + Cetus Homepage Hero

**Goal:** Replace weak gallery entries, add a clean A-grade example, and make the Cetus
retroactive audit (F29) the homepage's first impression instead of a buried CLI script.

## D3.1 — Gallery overhaul

```typescript
// scripts/gallery-audits.ts — replace the 2 synthetic entries:

const GALLERY_PACKAGES = [
  // 1. Cetus retroactive (already have this from F29 — reuse cetus-result.json)
  // 2. Your own movelens_demo vault (real, deployed, F15)
  { id: "<YOUR_DEMO_PACKAGE_ID_FROM_F15>", name: "@movelens/demo", description: "MoveLens Demo Vault (intentional findings)" },
  // 3. A KNOWN-CLEAN reference — Sui framework coin module
  { id: "0x0000000000000000000000000000000000000000000000000000000000000002", name: "0x2::coin", description: "Sui Framework — Coin module (reference clean audit)" },
];

// For the Sui framework package (0x2), fetchPackage via GraphQL should work
// the same as any other package — it's a real on-chain address.
// Run the full audit pipeline (Layers 1-4) — expect risk_grade close to "A"
// (framework code is heavily reviewed; if findings appear, they're likely
// low-severity Layer 4 false positives — that's fine, it's still informative).
```

```json
// src/app/gallery.json — final structure should have 3 entries:
// [
//   { "blobId": "5cN1fBWk5T...", "mvrName": null, "description": "Cetus AMM — May 2025 exploit, post-fix mainnet", "riskGrade": "F", "severityCounts": {...}, "highlight": "ML-INT-001 fires — this rule would have caught the $223M bug" },
//   { "blobId": "...", "mvrName": "@movelens/demo", "description": "MoveLens Demo Vault", "riskGrade": "...", "severityCounts": {...} },
//   { "blobId": "...", "mvrName": "0x2::coin", "description": "Sui Framework reference (known-clean)", "riskGrade": "A or B", "severityCounts": {...} }
// ]
```

- [ ] When re-running the Cetus entry's severity_counts for the gallery card, if 34 criticals
      still looks excessive, add a `highlight` field (as above) that calls out the ONE
      finding that matters (ML-INT-001) rather than letting "34 critical" stand alone.
      This directly addresses Report 3 Gap 1 without re-tuning the engine's thresholds
      (which D1 already did somewhat).

## D3.2 — Cetus homepage hero

```typescript
// src/app/page.tsx — add a hero section ABOVE the audit input form:
// Auto-loads the cached Cetus gallery entry (no live audit needed — instant render).

import cetusEntry from "./gallery.json"; // first entry, or filter by description.includes("Cetus")

function CetusHero({ entry }: { entry: GalleryEntry }) {
  return (
    <section className="border rounded-lg p-6 mb-8 bg-gradient-to-br from-red-50 to-orange-50 dark:from-red-950 dark:to-orange-950">
      <div className="flex items-center gap-2 mb-2">
        <RiskGradeBadge grade="F" />
        <span className="text-sm font-mono text-muted-foreground">Cetus AMM — May 22, 2025</span>
      </div>
      <h2 className="text-xl font-bold mb-2">$223,000,000 lost to one bit-shift.</h2>
      <p className="text-sm text-muted-foreground mb-4">
        ML-INT-001 fires on the real, deployed Cetus contract with confidence 1.0.
        This rule runs in under 5 seconds and costs nothing.
      </p>
      
      {/* Side-by-side: vulnerable code vs OZ-safe pattern */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        <div className="bg-red-100 dark:bg-red-900 rounded p-3">
          <p className="text-xs font-semibold mb-1 text-red-700 dark:text-red-300">VULNERABLE (deployed)</p>
          <pre className="text-xs overflow-x-auto"><code>{`let mask = 0xffffffffffffffff << 192;
if (n > mask) { (0, true) }
else { (n << 64, false) }`}</code></pre>
        </div>
        <div className="bg-green-100 dark:bg-green-900 rounded p-3">
          <p className="text-xs font-semibold mb-1 text-green-700 dark:text-green-300">OZ SAFE PATTERN</p>
          <pre className="text-xs overflow-x-auto"><code>{`u256::checked_shl(n, 64)
  // returns None on overflow,
  // never silently truncates`}</code></pre>
        </div>
      </div>
      
      <div className="flex gap-3">
        <a href={`https://aggregator.walrus-testnet.walrus.space/v1/blobs/${entry.blobId}`}
           target="_blank" className="text-sm underline">
          View permanent audit on Walrus ↗
        </a>
        <button onClick={() => runLiveCetusAudit()} className="text-sm underline">
          Re-run live →
        </button>
      </div>
    </section>
  );
}
```

- [ ] `runLiveCetusAudit()` can simply pre-fill the audit form with the Cetus package ID
      and submit — reuses the existing F19/F21 pipeline. No new backend logic needed.

## Task D3 — Verify

- [ ] `src/app/gallery.json` has exactly 3 entries: Cetus, movelens_demo, 0x2::coin
- [ ] Each entry's `blobId` is fetchable from the Walrus aggregator
- [ ] Cetus entry has a `highlight` field calling out ML-INT-001 specifically
- [ ] Homepage renders the Cetus hero ABOVE the audit form, with side-by-side code panels
- [ ] "View permanent audit on Walrus" link opens the real blob in a new tab
- [ ] "Re-run live" button pre-fills the audit form with the Cetus package ID

---

# TASK D4 — Demo Fallback + SECURITY.md + PRIVACY.md

**Goal:** Protect against the documented ~50% Walrus testnet upload failure rate during a
live demo, and add the two documentation files both reviews flagged as missing.

## D4.1 — `DEMO_MODE_BLOB_ID` fallback

```typescript
// .env.example — add:
// DEMO_MODE_BLOB_ID=5cN1fBWk5TIXUlJv-Do7pWYjc3AknRCJ-buNt_JdnPA  # Cetus audit, used as fallback

// src/app/api/audit/route.ts — in runPipeline(), wrap the Walrus upload step:
job.status = "uploading";
try {
  const { blobId } = await uploadAuditQuilt(quilt);
  job.blobId = blobId;
} catch (e) {
  const fallback = process.env.DEMO_MODE_BLOB_ID;
  if (fallback) {
    console.warn("[pipeline] Walrus upload failed — using DEMO_MODE_BLOB_ID fallback");
    job.blobId = fallback;
    job.degraded = true; // NEW field — surface in UI
  } else {
    throw e; // no fallback configured — fail normally
  }
}
```

```typescript
// src/app/audit/[id]/page.tsx — if job.degraded, show a banner:
{report.degraded && (
  <div className="bg-yellow-100 dark:bg-yellow-900 border border-yellow-400 rounded p-3 mb-4 text-sm">
    ⚠ Live Walrus upload was unavailable — showing a cached reference audit
    (Cetus retroactive audit) to demonstrate the report format. Your audit's
    findings above are real; the blob ID shown is a cached example.
  </div>
)}
```

- [ ] Add `degraded: z.boolean().default(false)` to the AuditReport-adjacent job status type
      (not the AuditReport schema itself — this is job-store metadata).

## D4.2 — SECURITY.md

```markdown
// SECURITY.md — create at project root:

# MoveLens Security Model

## Threat Model
MoveLens analyzes untrusted Move source code. We assume:
- Move source may contain adversarial content (crafted to evade detection or
  manipulate the AI layers)
- The LanceDB corpus may receive community contributions (potential poisoning)
- Layer 4 (Ollama/Groq) processes raw code as LLM input (prompt injection surface)

## Mitigations
- **Comment/string stripping** (`sanitizeForPatterns`): applied before Layer 1
  regex matching AND before any Layer 4 model call. Defeats comment-based
  rule suppression and most prompt-injection-via-comment attempts.
- **Rule registry guard**: Layer 4 findings must reference a `rule_id` that
  exists in `rule-ids.ts`. Unknown categories are dropped and logged.
- **Category-severity floor**: Layer 4 cannot downgrade a Layer 1/Layer 2
  finding's severity for the same vulnerability class.
- **Groq rate limiting**: 20 requests/minute cap prevents free-tier exhaustion
  from large/malicious inputs.
- **Global snippet cap**: max 20 snippets analyzed per audit, regardless of
  source file size.

## Known Limitations
- **Regex-based Layer 1** (65 rules) can produce false positives on unusual
  but legitimate code patterns, and can theoretically be evaded by
  sufficiently obfuscated code. Layer 1 confidence is always 1.0 for a
  pattern MATCH — it is not a guarantee the matched code is exploitable.
- **Layer 4 (DeepSeek-1.3B)** is a small model; classification accuracy on
  novel Move patterns is estimated at 60-70%, not the confidence scores
  literally suggest. Layer 4 findings are explicitly lower-confidence and
  marked as such in the UI.
- **19 AST-based rules are not yet implemented** — these are scoped for a
  future release pending a Move AST parser integration.
- **LanceDB corpus** is currently seeded without cryptographic verification.
  A future release will add corpus checksums.

## Reporting a Vulnerability
This is a hackathon submission (Sui Overflow 2026). For security concerns
about MoveLens itself, open an issue on the repository.
```

## D4.3 — PRIVACY.md

```markdown
// PRIVACY.md — create at project root:

# MoveLens Privacy & Data Handling

## What's Public (always, in `report.json` and `summary.md`)
- A salted hash of the audited package ID (`package_ref`) — NOT the raw address
- Severity counts and overall risk grade
- The audit watermark and timestamp
- The fixed watermark: "Automated pre-screen — not a substitute for a human audit."

## What's Private (in `findings.enc`, Seal-encrypted)
- Full finding details: descriptions, impacted code, recommendations, line numbers
- Only decryptable by the package owner's identity (via Seal IBE)

## On-Chain Publishing (opt-in, default OFF)
By default, MoveLens does NOT write anything on-chain. If you check
"Publish audit trail on-chain via MVR":
- The Walrus blob ID is attached to the package's MVR metadata (`set_metadata`)
- The package's MVR name (if registered) becomes associated with this audit
  in the public `report.json`
- This requires you to own the package's `PackageInfo` object

## Data Retention
Walrus blobs are stored for a fixed number of epochs (currently 5) and are
content-addressed and permanent for that duration. MoveLens does not currently
offer a deletion mechanism for published blobs — this is a known limitation
of the underlying Walrus storage model, not specific to MoveLens.

## Local Data
Audit job status is stored locally in `audits.db` (SQLite) and pruned after
24 hours. No audit data is sent to MoveLens operators — all processing
(Layers 1-4, including the AI models) runs locally or via your own
free-tier API keys (Groq).
```

## Task D4 — Verify

- [ ] Set `DEMO_MODE_BLOB_ID` in `.env`; artificially break Walrus upload (wrong network);
      verify the audit completes with `degraded: true` and the cached blob ID
- [ ] UI shows the yellow degraded banner when `degraded: true`
- [ ] `SECURITY.md` and `PRIVACY.md` exist at project root, both readable, both accurate
      to the current codebase (no references to features that don't exist)

---

# TASK D5 — README Business Model + Patch Snippets

**Goal:** Two cheap, zero-risk additions — a business model paragraph (Vision criterion)
and copy-paste patch suggestions for the top 5 finding categories (actionability).

## D5.1 — README business model paragraph

```markdown
// README.md — add a new section near the end, before "Setup":

## Beyond the Hackathon

MoveLens is free for open-source Move projects today — all AI layers run
locally (DeepSeek-1.3B via Ollama, Jina embeddings) or on free tiers (Groq).
Zero marginal cost per audit.

Potential paths to sustainability:
- **CI integration**: a GitHub Action that runs MoveLens on every PR to a
  Move package, posting findings as a review comment — the natural extension
  of the "audit before you ship" workflow this tool already enables.
- **Ecosystem infrastructure**: the Walrus + Seal + MVR combination used here
  is a general pattern for on-chain-verifiable, privacy-respecting attestations
  — applicable beyond security audits (code quality scores, compliance checks).
- **Managed tier**: for teams wanting faster Layer 4 inference (larger models,
  dedicated compute) or private corpora, a hosted option could fund continued
  development while the local/free path remains available to all.
```

## D5.2 — Patch before/after snippets (top 5 categories)

```typescript
// src/lib/audit/layer4.ts — extend RECOMMENDATIONS into a richer structure
// for the 5 highest-frequency categories. Keep the existing string map for
// the other 8 categories (no regression).

interface PatchSuggestion {
  recommendation: string;
  before?: string;  // Move snippet showing the vulnerable pattern
  after?: string;   // Move snippet showing the fixed pattern
}

const PATCH_SUGGESTIONS: Partial<Record<string, PatchSuggestion>> = {
  "ML-INT": {
    recommendation: "Use OZ checked_shl instead of raw bit-shifts.",
    before: `let mask = 0xffffffffffffffff << 192;\nlet r = n << 64;`,
    after:  `let r = u256::checked_shl(n, 64);\nassert!(option::is_some(&r), EOverflow);`,
  },
  "ML-ACC": {
    recommendation: "Gate privileged functions with a capability check.",
    before: `public fun withdraw(vault: &mut Vault, amount: u64, ctx: &mut TxContext) { ... }`,
    after:  `public fun withdraw(_cap: &AdminCap, vault: &mut Vault, amount: u64, ctx: &mut TxContext) { ... }`,
  },
  "ML-ARI": {
    recommendation: "Multiply before dividing; use mul_div for fee calculations.",
    before: `let fee = amount / 10000 * fee_bps;`,
    after:  `let fee = u64::mul_div(amount, fee_bps, 10000, RoundingMode::Down);`,
  },
  "ML-HOT": {
    recommendation: "Hot-potato structs must have NO abilities and a matching consume function.",
    before: `struct Receipt { amount: u64 }`,
    after:  `struct Receipt { amount: u64 } // no abilities — must add: public fun consume_receipt(r: Receipt) { let Receipt { amount: _ } = r; }`,
  },
  "ML-UPG": {
    recommendation: "Validate the UpgradeCap's package ID before authorizing upgrades.",
    before: `public fun do_upgrade(cap: &UpgradeCap, ...) { package::authorize_upgrade(cap, ...) }`,
    after:  `public fun do_upgrade(cap: &UpgradeCap, ...) {\n  assert!(package::upgrade_package(cap) == EXPECTED_PACKAGE_ID, EWrongPackage);\n  package::authorize_upgrade(cap, ...)\n}`,
  },
};

function getRecommendation(category: string): string {
  return PATCH_SUGGESTIONS[category]?.recommendation
    ?? RECOMMENDATIONS[category]  // existing string map, unchanged for other categories
    ?? "Review the code for security vulnerabilities identified by the ML model.";
}

// Add before/after to the Finding when available:
// finding.patch_before = PATCH_SUGGESTIONS[category]?.before ?? null;
// finding.patch_after  = PATCH_SUGGESTIONS[category]?.after ?? null;
```

```typescript
// src/lib/audit/schema.ts — add optional fields to Finding:
// patch_before: z.string().nullable().default(null),
// patch_after:  z.string().nullable().default(null),
```

```typescript
// src/app/audit/[id]/page.tsx — in the expanded finding view, if patch_before
// and patch_after are present, render a side-by-side diff with a "Copy fix" button:

{finding.patch_after && (
  <div className="mt-2">
    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
      <div>
        <p className="text-xs text-muted-foreground mb-1">Before</p>
        <pre className="text-xs bg-red-50 dark:bg-red-950 p-2 rounded overflow-x-auto"><code>{finding.patch_before}</code></pre>
      </div>
      <div>
        <p className="text-xs text-muted-foreground mb-1">After</p>
        <pre className="text-xs bg-green-50 dark:bg-green-950 p-2 rounded overflow-x-auto"><code>{finding.patch_after}</code></pre>
      </div>
    </div>
    <button
      onClick={() => navigator.clipboard.writeText(finding.patch_after!)}
      className="text-xs underline mt-1"
    >
      Copy fix
    </button>
  </div>
)}
```

## Task D5 — Verify

- [ ] README.md has the "Beyond the Hackathon" section
- [ ] Run audit on overflow.move — verify the ML-INT-001 finding has non-null
      `patch_before`/`patch_after` fields
- [ ] UI renders the before/after side-by-side for findings with patches
- [ ] "Copy fix" button copies `patch_after` to clipboard (manual browser check)
- [ ] Findings in the other 8 categories still render normally (no `patch_before`/`after`
      shown, existing `recommendation` string still displays)

---

# FINAL CHECKLIST (Day 6-7, after D1-D5 complete)

- [ ] Full end-to-end dry run: fresh `./init.sh` → audit a real testnet package from the
      browser → verify gallery, Cetus hero, findings with patches, trust panel all render
- [ ] Confirm Walrus testnet wallet has sufficient SUI (top up via faucet if needed)
- [ ] Confirm `DEMO_MODE_BLOB_ID` fallback works (test by temporarily breaking Walrus config)
- [ ] Read through SECURITY.md and PRIVACY.md once more — make sure nothing references
      a feature that doesn't actually exist in the shipped code
- [ ] git log — confirm every D1-D5 task has its own commit with a clear message
- [ ] Update progress.txt with a final summary session entry

**Day 7: rehearsal + submission. No code changes.**
