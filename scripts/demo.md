# MoveLens — 3-Minute Demo Script

> **Sui Overflow 2026 · Walrus Specialized Track**
> Judging criteria: Real-World (50%) · UX (20%) · Technical (20%) · Vision (10%)

---

## Pre-Demo Checklist (before judges arrive)

- [ ] `./init.sh` → RESULT: HEALTHY
- [ ] `http://localhost:3000` loads with the Cetus hero visible above the audit form
- [ ] `DEMO_MODE_BLOB_ID` set in `.env` (Walrus fallback armed)
- [ ] Browser DevTools closed; zoom = 100%
- [ ] Backup blob URLs ready below in case Walrus testnet is slow

---

## The 3-Minute Flow

### 0:00–0:30 — The Cetus Hero (homepage, no clicks needed)

Navigate to `http://localhost:3000`.

> *"This is the homepage. The first thing you see is the actual $223 million
> Cetus exploit from May 2025 — a single bit-shift bug, `checked_shlw`, with
> the wrong overflow mask."*

**[Point at the side-by-side panels: vulnerable code (red) vs OpenZeppelin-safe
pattern (green)]**

> *"MoveLens's rule ML-INT-001 — this exact regex — fires on this exact pattern,
> with confidence 1.0, in under 5 seconds, for free."*

**[Click "View permanent audit on Walrus" → opens the Cetus blob in a new tab]**

> *"That's a permanent, publicly verifiable audit. Anyone, forever, can check this."*

**→ Judging hit: Real-World (50%), Vision (10%)** — immediate proof of value, no setup

---

### 0:30–1:00 — Re-run It Live

**[Click "Re-run live" on the hero — pre-fills the Cetus package address + mainnet]**

**[Click "Run Audit" — watch the pipeline stepper on `/audit/<id>`]**

> *"Layer 1 catches it instantly — that's the deterministic rule engine, 65 regex
> rules across 13 vulnerability sectors. Layers 2 through 4 add the OpenZeppelin
> benchmark, semantic memory recall via LanceDB, and Groq's llama-3.3-70b model —
> all running at zero cost with the free tier."*

Point to each stage lighting up:

| Stage | What to say |
|-------|-------------|
| **Fetching Package** | "Fetching from Sui GraphQL — we never use JSON-RPC, it shuts down July 31." |
| **Running 4-Layer Analysis** | "Layer 1: 65 deterministic rules, confidence 1.0. Layer 2: OZ benchmark. Layer 3: LanceDB recall. Layer 4: Groq llama-3.3-70b classification." |
| **Encrypting Findings** | "Seal IBE encryption — findings go into findings.enc, only decryptable by the auditor." |
| **Uploading to Walrus** | "Encrypted quilt: report.json + findings.enc + summary.md. 5 epochs of guaranteed storage." |
| **MVR Linking** | "Blob ID attached on-chain to the package via MVR set_metadata." |

**→ Judging hit: Technical (20%)** — all 4 layers + Walrus + Seal + MVR live

---

### 1:00–2:00 — A Real Audit: Findings → Fixes

**[Navigate to the gallery entry for `@movelens/demo` (or use the audit that just finished)]**

> *"Here's our own demo contract — it has intentional bugs. Let's look at a finding."*

**[Expand 1–2 findings — show the before/after patch panels]**

> *"Not just 'this is wrong' — a before/after code panel with a Copy Fix button.
> MoveLens doesn't just diagnose; it prescribes the exact patch."*

**[Click "Copy fix" on the ML-INT-001 finding]**

> *"One click. The fix is in the clipboard."*

**→ Judging hit: UX (20%), Real-World (50%)** — actionable output, not just a score

---

### 2:00–2:40 — The Trust Layer (Seal + Walrus + MVR)

**[Scroll to the Trust Panel at the bottom of the report]**

> *"The full report is Seal-encrypted, bundled as a Walrus Quilt, stored
> permanently, and linked on-chain via MVR set_metadata — the audit becomes
> part of the package's permanent identity."*

**[Click the Walrus blob link → opens report.json from Walrus]**

Show judges:
- `watermark: "Automated pre-screen — not a substitute for a human audit."`
- `risk_grade`
- `severity_counts`
- `sealed: true`

> *"findings.enc is IBE-encrypted — you'd need the signer key to decrypt via Seal."*

**→ Judging hit: Real-World (50%)** — verifiable on-chain provenance

---

### 2:40–3:00 — Close

**[Return to homepage, point to the gallery: F (Cetus) · D (demo vault) · A (0x2::coin)]**

> *"Three audits. One catastrophic failure, one intentional bug fixture, one clean
> reference. We don't just flag everything — here's the Sui Framework coin module
> getting an A grade."*

> *"Zero-cost. 90 seconds. Permanent. Verifiable. That's MoveLens."*

**→ Judging hit: Vision (10%)** — differentiated positioning, not just another scanner

---

## Backup Plan

If the live URL is cold (idle >15 min), the first request takes ~30-60s to wake
up. Visit the URL once, 5 minutes before presenting, to warm it up.

If live Walrus upload fails during the demo, the UI automatically shows a cached
reference audit (controlled by `DEMO_MODE_BLOB_ID` in `.env`, set to the Cetus blob)
with a clear amber "Cached reference audit shown" banner. The findings displayed are
still real and accurate — only the on-chain storage step used a fallback.

The Cetus hero's "View permanent audit on Walrus" link always works regardless of
live upload status (it points to the pre-stored blob `5cN1fBWk5TIXUlJv-Do7pWYjc3AknRCJ-buNt_JdnPA`).

---

## Backup Assets

### Cetus Retroactive Audit (pre-stored)

| Field | Value |
|-------|-------|
| **Package** | `0xa9b0ffe2f8e713a66ad1aa361cf1984526a5048c6de786b4dd292f3eed204b92` |
| **Network** | mainnet |
| **Walrus Blob** | `5cN1fBWk5TIXUlJv-Do7pWYjc3AknRCJ-buNt_JdnPA` |
| **Walrus URL** | https://aggregator.walrus-testnet.walrus.space/v1/blobs/5cN1fBWk5TIXUlJv-Do7pWYjc3AknRCJ-buNt_JdnPA |

### Demo Package on Testnet

| Field | Value |
|-------|-------|
| **Package ID** | `0x6bcb6936da7f7df80741e0abb7aa5fb78d160a7be227f48b0a6f0c9c83648698` |
| **PackageInfo ID** | `0xcc7af44f578839df65cd69705c640559aa594b6528161653b91416cdec7a50e2` |
| **Publish TX** | `85rKhcZxaSpubzxHs81P1o57wfQqQL1rD5Rqf2YBJCZH` |
| **Suiscan** | https://suiscan.xyz/testnet/object/0x6bcb6936da7f7df80741e0abb7aa5fb78d160a7be227f48b0a6f0c9c83648698 |

### Signer Address

```
0x8a271c5a35e7fdac64fd811b57d6e605f81697fd12b8a1867300abf867429d57
```

---

## Judging Criteria Mapping

| Criterion | Weight | What to show |
|-----------|--------|--------------|
| **Real-World Utility** | 50% | Cetus hero: real $223M exploit caught live · Findings with patch panels · Walrus blob verifiable by anyone · MVR on-chain linkage · Seal-encrypted findings |
| **UX & Product** | 20% | Cetus hero above the fold · 6-stage animated stepper · Risk grade + severity chips · Expandable findings with before/after patches + Copy Fix · Gallery (F/D/A grades) |
| **Technical Excellence** | 20% | 65 deterministic regex rules (zero cost) · OZ deviation checks · LanceDB semantic recall · Seal IBE · Walrus quilt storage · MVR set_metadata PTB · GraphQL-only (JSON-RPC banned) |
| **Vision** | 10% | "Zero-cost deterministic-first security engine" — no paid LLM dependency · Permanent on-chain audit trail · CI integration path documented in README |
