# TASK_GROQ_SWITCH.md — Replace Local Ollama with Groq API for Layer 4

> **Goal:** Remove the local Ollama/DeepSeek-1.3B dependency entirely (source of the
> Windows cold-start timeouts you hit). Replace it with the Groq free-tier API as
> Layer 4's primary classifier. Keep Model A (Jina embeddings, local) unchanged.
> Remove the now-redundant Model C "Groq confirms Groq" step.
> **No new feature IDs.** F26/F27/F28 still pass — this is an internal swap, not a
> new feature. The outcome ("Layer 4 runs, produces findings, zero paid API calls")
> is unchanged; Groq free tier already satisfies the no-paid-API rule.

---

## New Layer 4 architecture (2 models, was 3)

```
Model A: Jina embeddings (local, sidecar /embed)        — UNCHANGED
Model B: Groq llama-3.3-70b-versatile (free tier)        — NEW, replaces DeepSeek-via-Ollama
Fallback: keyword heuristic (sidecar /classify)           — UNCHANGED, used only if
                                                              Groq is unreachable, rate-
                                                              limited, or no API key set
```

Model C (the old "confirm uncertain DeepSeek results with Groq" step) is REMOVED —
pointless once Groq itself is the classifier.

---

## TASK G1 — TypeScript: add `classifyWithGroq()`, remove `confirmWithGroq()`

**File:** `src/lib/audit/layer4.ts`

### G1.1 — New Groq classification function

```typescript
// Add near the top of layer4.ts, replacing the old confirmWithGroq() function entirely.

import { sanitizeForPatterns } from "./sanitize";

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

interface ClassifyResult {
  vulnerable: boolean;
  category:   string;
  confidence: number;
  reason:     string;
}

/**
 * Model B: Groq llama-3.3-70b-versatile (free tier).
 * Returns null on ANY failure (missing key, rate limit, network error, bad JSON) —
 * caller MUST fall back to the sidecar heuristic classifier on null.
 * NEVER throws.
 */
async function classifyWithGroq(rawCode: string, memoryContext: string): Promise<ClassifyResult | null> {
  const apiKey = env.GROQ_API_KEY;
  if (!apiKey) return null;
  if (!canCallGroq()) return null; // reuse existing rate-limit bucket from F33/D5 — see G1.3

  const cleanCode = sanitizeForPatterns(rawCode, false); // ALWAYS sanitize before sending to any LLM
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
```

### G1.2 — Fallback function (renamed, sidecar heuristic only)

```typescript
// Rename the EXISTING classifySnippet() function (which POSTs to sidecar /classify)
// to classifyFallback() — it still works exactly as before, just used as the
// fallback path now instead of the primary path. Its body/fetch logic is UNCHANGED.

async function classifyFallback(code: string): Promise<ClassifyResult> {
  // existing implementation — POST to `${SIDECAR}/classify`, unchanged
  // (this now hits the simplified Python /classify from Task G2 — heuristic only)
}
```

### G1.3 — Update the rate limiter to gate Groq classification (not confirmation)

```typescript
// The existing Groq rate limiter (groqBucket / canCallGroq) from F33/D5 stays —
// just repoint its usage. It previously gated confirmWithGroq(); now it gates
// classifyWithGroq(). No structural change to the bucket itself, only WHERE
// canCallGroq() is called from (already shown inside classifyWithGroq() above).

// DELETE the old confirmWithGroq() function entirely — it's no longer called anywhere.
```

### G1.4 — Update the per-snippet pipeline

```typescript
// In the main per-snippet analysis function (analyzeSnippet / inside runLayer4):

// BEFORE (old 3-model flow):
//   const classResult = await classifySnippet(snippet.code);
//   ... confidence boost from simResult ...
//   if (confidence >= 0.4 && confidence <= 0.7) {
//     const confirmed = await confirmWithGroq(snippet.code, classResult.category);
//     confidence = confirmed ? confidence + 0.1 : confidence - 0.1;
//   }

// AFTER (new 2-model flow):
const memCtx = buildMemoryContext(memoryHits); // existing function, unchanged (from E5 sanitize fix)
let classResult = await classifyWithGroq(snippet.code, memCtx);
if (classResult === null) {
  classResult = await classifyFallback(snippet.code); // sidecar heuristic, always succeeds
}

let confidence = classResult.confidence;
if (simResult.similar_to && confidence < 0.8) {
  confidence = Math.min(0.95, confidence + 0.15); // unchanged from D1.3/E recalibration
}
// NO Model C step — remove the 0.4-0.7 confirmation block entirely.
```

### G1.5 — Update the stale header docstring

```typescript
// layer4.ts top-of-file comment block — replace the old "Model B: keyword
// heuristic" / "Model C: Groq confirmation" description with:
//
// Pipeline per snippet:
//   Model A: Jina embed (sidecar) → LanceDB cosine similarity > 0.75 → boost flag
//   Model B: Groq llama-3.3-70b-versatile (free tier) → full classification
//            Falls back to sidecar keyword heuristic if Groq unavailable/rate-limited
//   Final:   confidence = clamp(B.confidence + (A.similar && B.conf < 0.8 ? +0.15 : 0), 0, 1)
```

---

## TASK G2 — Python: strip Ollama from the sidecar entirely

**File:** `scripts/layer4_server.py`

```python
# REMOVE entirely:
#   - OLLAMA_URL constant
#   - DEEPSEEK_MODEL constant
#   - DEEPSEEK_PROMPT_TEMPLATE constant
#   - _call_ollama() function

# KEEP unchanged:
#   - HEURISTIC_RULES list
#   - _strip_move_comments() (defense-in-depth, TS already sanitizes before sending)
#   - heuristic_classify() — but simplify it to ONLY run the keyword heuristic,
#     no Ollama branch:

def heuristic_classify(code: str) -> dict:
    """
    Sidecar fallback classifier — pure keyword heuristic.
    Used only when the TypeScript layer's Groq call fails or is rate-limited.
    """
    clean_code = _strip_move_comments(code)
    for pattern, category, severity, base_conf, reason in HEURISTIC_RULES:
        if pattern.search(clean_code):
            return {"vulnerable": True, "category": category,
                    "severity": severity, "confidence": base_conf, "reason": reason}
    return {"vulnerable": False, "category": "ML-LOG",
            "severity": "info", "confidence": 0.1, "reason": "No known vulnerability pattern detected"}

# /classify endpoint stays, but now ONLY calls heuristic_classify() — no model_context
# param needed since there's no LLM prompt being built here anymore:

@app.route("/classify", methods=["POST"])
def classify():
    body = request.get_json(force=True, silent=True) or {}
    code = body.get("code", "") or body.get("prompt", "")
    if not code:
        return jsonify({"error": "missing 'code' field"}), 400
    try:
        return jsonify(heuristic_classify(code))
    except Exception as exc:
        log.error("/classify error: %s", exc)
        return jsonify({"error": str(exc)}), 500

# /health endpoint: remove "ollama_available" field — it no longer applies.
```

---

## TASK G3 — Env vars and init.sh

```bash
# .env.example — REMOVE:
#   OLLAMA_URL=http://localhost:11434
#
# UPDATE the GROQ_API_KEY comment:
GROQ_API_KEY=your_key_here   # REQUIRED for real Layer 4 classification.
                              # Without it, Layer 4 runs in keyword-heuristic-only mode.
```

```bash
# init.sh — REMOVE the "ollama list" / "Ollama running on :11434" check block entirely.
# ADD in its place (same step 8/9 location):

if [ -z "$GROQ_API_KEY" ]; then
  bad "GROQ_API_KEY not set — Layer 4 will run in heuristic-only fallback mode (no real AI classification)"
else
  ok "GROQ_API_KEY configured — Layer 4 will use Groq llama-3.3-70b for classification"
fi
```

---

## TASK G4 — Documentation sweep (CRITICAL — do not skip)

Every prior review flagged doc-vs-code drift as a top judge-visible risk. Search these
files for "Ollama" and "DeepSeek" and replace with "Groq llama-3.3-70b-versatile
(free tier)":

- [ ] `README.md` — architecture section, tech stack table, any setup instructions
      mentioning "install Ollama" or "ollama pull deepseek-coder"
- [ ] `CLAUDE.md` — the 12-step pipeline description, the hard rules section
- [ ] `IMPLEMENTATION.md` — Task 2.6/2.7 pseudocode headers (historical — update the
      description text, the pseudocode itself can stay as a record of the prior design
      if you prefer, but the ACTIVE description must say Groq)
- [ ] `SECURITY.md` — the "DeepSeek-1.3B is too small, ~60-70% accuracy" line should be
      updated or removed (Groq's llama-3.3-70b is a much larger, more capable model —
      this limitation no longer applies in the same way; consider noting Groq's free-tier
      rate limit as the new relevant constraint instead)
- [ ] `PRIVACY.md` — check for any Ollama/local-model privacy claims that need updating
      (data now leaves the machine to Groq's API — note this explicitly: "Code snippets
      sent to Layer 4 are transmitted to Groq's API for classification; see Groq's
      privacy policy. Comments and string literals are stripped before transmission.")

---

## Task G — Verify

- [ ] `grep -rli "ollama\|deepseek" src/ scripts/` returns ZERO matches (except this
      task file itself, which is historical record)
- [ ] Run the vulnerable test snippet (drain/unsafe_shift/calc_fee from earlier) through
      a real audit — verify Layer 4 findings appear with `reason` text that reads like
      a real model response (not generic heuristic phrasing)
- [ ] Temporarily unset `GROQ_API_KEY` — re-run the same audit — verify it still
      completes successfully using the heuristic fallback (check logs for "Groq classify"
      NOT being called, heuristic result used instead)
- [ ] Send 25 snippets rapidly (reuse the F33 rate-limit test) — verify the 21st+ calls
      skip Groq and use the fallback (check logs), audit still completes
- [ ] Run the existing fixture suite (`test/f08-verify.ts`, `test/f10-verify.ts`) —
      verify NO regression (Layer 1/2 are untouched by this change)
- [ ] `curl http://localhost:8765/health` — verify response no longer includes
      `ollama_available` field
- [ ] `grep -rli "ollama\|deepseek" README.md CLAUDE.md SECURITY.md PRIVACY.md IMPLEMENTATION.md`
      returns ZERO matches in the ACTIVE description text (historical pseudocode
      references in IMPLEMENTATION.md are acceptable if clearly marked as superseded)
