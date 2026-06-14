# MoveLens Security Model

## Threat Model

MoveLens analyzes untrusted Move source code. We assume:

- Move source may contain adversarial content (crafted to evade detection or
  manipulate the AI layers)
- The LanceDB corpus may receive community contributions (potential poisoning)
- Layer 4 (Ollama/Groq) processes raw code as LLM input (prompt injection surface)
- The Walrus quilt's `report.json` is public — it must never contain decrypted findings

## Mitigations

| Mitigation | Where | What it prevents |
|---|---|---|
| **Comment/string stripping** (`sanitizeForPatterns`) | Before Layer 1 regex matching and before every Layer 4 sidecar call | Comment-based rule suppression; prompt injection via crafted Move comments |
| **Rule registry guard** | `engine.ts` `mergeAndDedupe()` | Layer 4 emitting unknown `rule_id` values — unknown categories are dropped and logged |
| **Category-severity floor** (`CATEGORY_SEVERITY_FLOOR`) | `engine.ts` | Layer 4 silently downgrading a Layer 1/Layer 2 critical finding (ML-INT/ML-OZ floor = "high", ML-ACC = "medium") |
| **Groq rate limiter** | `src/lib/audit/groq.ts` | Free-tier exhaustion from large or adversarial inputs (20 RPM cap) |
| **Global snippet cap** | `layer4.ts` | Denial-of-service via massive source files (max 20 snippets per audit) |
| **Seal IBE encryption** | `src/lib/seal/encrypt.ts` | Findings readable only by package owner — not exposed in public Walrus quilt |
| **SHA-256 package reference** | `quilt.ts` `hashPackageId()` | Raw package address leaked in public `report.json` (hashed, not raw) |
| **`mvr_name` gate** | `quilt.ts` `buildQuilt()` | MVR name leaked in public metadata when user has not opted into on-chain publishing |

## Known Limitations

- **Regex-based Layer 1** (65 rules) can produce false positives on unusual but
  legitimate code patterns, and can theoretically be evaded by sufficiently obfuscated
  code. Layer 1 `confidence` is always 1.0 for a pattern match — it is not a
  guarantee the matched code is exploitable.

- **Layer 4 (DeepSeek-1.3B)** is a small model; classification accuracy on novel
  Move patterns is estimated at 60–70%, not the literal confidence scores shown.
  Layer 4 findings are explicitly lower-confidence and marked as such in the UI.

- **19 AST-based rules are not yet implemented** — scoped for a future release
  pending a Move AST parser integration.

- **LanceDB corpus** is currently seeded without cryptographic verification. A
  future release will add corpus checksums to detect poisoning.

- **No authentication on the audit API** — MoveLens runs as a local or
  self-hosted tool. Exposing `/api/audit` publicly without authentication would
  allow anyone to trigger audits against your Walrus/Groq quota.

## Reporting a Vulnerability

This is a hackathon submission (Sui Overflow 2026). For security concerns about
MoveLens itself, open an issue on the repository. Responsible disclosure is
appreciated — please allow 72 hours before public disclosure of novel findings.
