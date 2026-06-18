# MoveLens Privacy & Data Handling

## What's Public (always, in `report.json` and `summary.md`)

These fields appear in the unencrypted portion of every Walrus quilt blob:

| Field | Value |
|---|---|
| `package_ref` | SHA-256 hash of the audited package address — **not** the raw address |
| `mvr_name` | MVR package name — **only** when `publishOnChain: true` (default: `null`) |
| `risk_grade` | A / B / C / D / F letter grade |
| `severity_counts` | Aggregate counts by severity (no individual finding text) |
| `sealed` | Whether Seal IBE encryption was applied |
| `generated_at` | Audit timestamp |
| `watermark` | Fixed string: "Automated pre-screen — not a substitute for a human audit." |

`summary.md` renders a human-readable version of the same fields.

## What's Private (in `findings.enc`, Seal-encrypted)

These fields are encrypted with [Seal IBE](https://github.com/MystenLabs/seal)
and are only decryptable via the MoveLens Seal identity (see caveat below):

- Full finding details: descriptions, impacted code snippets, line numbers
- Recommendations and category labels
- Layer 4 confidence scores and ML model reasoning

## Encryption Identity (Current Limitation)

Audit reports are Seal-encrypted to a MoveLens-operated identity. For the demo
package (`@movelens/demo`), this identity coincides with the package owner,
so the "owner-only decryption" property holds in the demo.

For arbitrary third-party packages, owner-keyed encryption — where the actual
package owner's address is used as the Seal IBE identity, derived automatically
from on-chain ownership — is a v2 milestone. Today, MoveLens acts as a
trusted escrow for encrypted findings rather than encrypting directly to an
arbitrary owner's wallet.

This is a deliberate scope decision for the hackathon timeline, not an
oversight, and is tracked for the v2 roadmap alongside the disclosure-timer
work already described above.

## On-Chain Publishing (opt-in, default OFF)

By default, MoveLens does **not** write anything on-chain and does **not** include
the MVR package name in the public quilt metadata.

If you check **"Publish audit trail on-chain via MVR"** in the audit form:

1. The Walrus blob ID is attached to the package's MVR `PackageInfo` object via a
   `set_metadata` transaction (requires you to own the `PackageInfo` object).
2. The package's MVR name (if registered) is included in the public `report.json`
   as `mvr_name`.
3. The on-chain record is permanently associated with this audit blob for the
   duration of the Walrus storage epoch.

This is an explicit, informed opt-in — the checkbox is unchecked by default and
the implications are explained in the UI before submission.

## Data Retention

- **Walrus blobs** are stored for a fixed number of epochs (currently 5, approximately
  5–10 days on testnet). MoveLens does not offer a deletion mechanism for published
  blobs — this is a property of the underlying Walrus storage model.

- **Audit jobs** are stored locally in `audits.db` (SQLite, WAL mode) and pruned
  after 24 hours. No audit data is sent to MoveLens operators.

## Where Processing Happens

All AI processing runs locally or via your own API keys:

| Layer | Model | Where |
|---|---|---|
| Layer 1 — Deterministic rules | None (regex) | Local |
| Layer 2 — OZ benchmark | None (regex) | Local |
| Layer 3 — Memory recall | Jina embeddings (local) | Local (via Layer 4 sidecar) |
| Layer 4 — ML classification | Groq llama-3.3-70b-versatile (free tier) | **Groq API** (your key) |
| Layer 4 — Fallback classifier | Keyword heuristic | Local (via Layer 4 sidecar) |

**Important:** Code snippets extracted for Layer 4 analysis are transmitted to Groq's API
for classification. Comments and string literals are stripped before transmission
(`sanitizeForPatterns`). See [Groq's privacy policy](https://groq.com/privacy-policy/)
for how they handle API request data. No audit data is sent to MoveLens operators.
