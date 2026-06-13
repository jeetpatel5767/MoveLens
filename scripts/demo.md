# MoveLens — 3-Minute Demo Script

> **Sui Overflow 2026 · Walrus Specialized Track**
> Judging criteria: Real-World (50%) · UX (20%) · Technical (20%) · Vision (10%)

---

## Pre-Demo Checklist (before judges arrive)

- [ ] `./init.sh` → RESULT: HEALTHY
- [ ] `http://localhost:3000` loads the landing page
- [ ] Have the backup blob URL ready (below) in case Walrus testnet is slow
- [ ] Browser DevTools closed; zoom = 100%

---

## The 3-Minute Flow

### 0:00 — Open & Orient (20s)

Navigate to `http://localhost:3000`.

> *"MoveLens is a zero-cost security auditor for Sui Move contracts.
> Unlike tools that call an LLM and hope, we use a deterministic-first
> 4-layer hybrid engine — 93 rules, OZ deviation checks, Seal encryption,
> permanent Walrus storage. Judges can verify every finding on-chain."*

Point to the four badges in the top-right: **Layer 1**, **Layer 2**, **Walrus**, **Seal**.

**→ Judging hit: Vision (10%)** — differentiator framing

---

### 0:20 — Package Address Audit (30s)

Stay on the **Package Address** tab. Paste the demo vault:

```
0x6bcb6936da7f7df80741e0abb7aa5fb78d160a7be227f48b0a6f0c9c83648698
```

> *"This is a vault contract I deployed on testnet — it has intentional
> vulnerabilities: integer overflow in the deposit function, an AdminCap
> drain with no access control. Let's see what the engine finds."*

Click **Run Audit**. You land on `/audit/<id>`.

---

### 0:50 — Watch the Pipeline Stepper (60s)

Point to each stage lighting up:

| Stage | What to say |
|-------|-------------|
| **Fetching Package** | "Fetching modules from Sui GraphQL — we never use JSON-RPC, it shuts down July 31." |
| **Running 4-Layer Analysis** | "Layer 1 runs 93 deterministic regex rules — zero-cost, confidence 1.0. Layer 2 checks against OpenZeppelin safe math patterns. Cetus-class findings always sort first." |
| **Encrypting Findings** | "Findings are Seal IBE-encrypted — only the package owner can decrypt. The public blob has counts but not the full descriptions." |
| **Uploading to Walrus** | "The encrypted quilt goes to Walrus: report.json + findings.enc + summary.md. 5 epochs of guaranteed storage." |
| **MVR Linking** | "Blob ID is attached to the package via MVR's set_metadata call — on-chain audit trail." |

**→ Judging hit: Technical (20%)** — live demo of all 4 layers + Walrus + Seal + MVR

---

### 1:50 — Read the Report (30s)

When the stepper finishes, scroll down.

1. Point to the **risk grade** (should be **F** — it has critical findings)
2. Point to the **severity chips**: Critical X, High X, Medium X, Low X
3. Click the first **critical** finding to expand it:
   - Show the `rule_id` tag (`ML-INT-001` or `ML-OZ-001`)
   - Show the **confidence bar** (100% for deterministic rules)
   - Read the **recommendation** aloud
4. Scroll to the **Trust Panel** — show the Walrus blob ID link

> *"Every judge can independently verify this blob exists on Walrus.
> The blob ID is also attached on-chain to the package via MVR."*

**→ Judging hit: Real-World (50%)** — genuine on-chain provenance

---

### 2:20 — Trust Panel Deep Dive (30s)

Click the **Walrus blob link** (or paste the backup URL below):

```
https://aggregator.walrus-testnet.walrus.space/v1/blobs/lFiTFEnn-pRmpu4kfLnC1w0dLoiWR4MvWW5Wbu4UuM8
```

This opens `report.json` directly from Walrus — show:
- `watermark: "Automated pre-screen — not a substitute for a human audit."`
- `risk_grade: "F"`
- `severity_counts: { critical: ..., high: ... }`
- `sealed: true`

> *"The findings themselves are in findings.enc — IBE-encrypted.
> You'd need the owner's wallet key to decrypt them via Seal."*

If time allows: show the **MVR TX** link on Suiscan.

**→ Judging hit: Real-World (50%)** — verifiable Walrus storage + Seal privacy

---

### 2:50 — Closing (10s)

> *"In summary: zero external API cost, fully on-chain provenance,
> Seal-encrypted findings for privacy, 93 deterministic rules plus
> OZ benchmarking. The full source is open — every judge can run
> `./init.sh` and audit any testnet package in under 5 minutes."*

---

## Backup Assets (if live infra fails)

### Pre-recorded Audit — overflow.move fixture

| Field | Value |
|-------|-------|
| **Walrus Blob ID** | `lFiTFEnn-pRmpu4kfLnC1w0dLoiWR4MvWW5Wbu4UuM8` |
| **Walrus URL** | `https://aggregator.walrus-testnet.walrus.space/v1/blobs/lFiTFEnn-pRmpu4kfLnC1w0dLoiWR4MvWW5Wbu4UuM8` |
| **Audited** | 2026-06-13 (Session 15) |
| **Risk grade** | F (critical findings found) |
| **Findings** | ML-INT-001 (critical), ML-INT-002 (critical), ML-OZ-001 ×2 (critical), ML-INT-003 (high), ML-UPG-001 (medium) |

### Demo Package on Testnet

| Field | Value |
|-------|-------|
| **Package ID** | `0x6bcb6936da7f7df80741e0abb7aa5fb78d160a7be227f48b0a6f0c9c83648698` |
| **PackageInfo ID** | `0xcc7af44f578839df65cd69705c640559aa594b6528161653b91416cdec7a50e2` |
| **Publish TX** | `85rKhcZxaSpubzxHs81P1o57wfQqQL1rD5Rqf2YBJCZH` |
| **set_metadata TX** | `HmhWjcJymAsaLmVXMA3qWN5B4rBDJSZNM8P87QosfF9B` |
| **Suiscan** | `https://suiscan.xyz/testnet/object/0x6bcb6936da7f7df80741e0abb7aa5fb78d160a7be227f48b0a6f0c9c83648698` |

### Signer Address

```
0x8a271c5a35e7fdac64fd811b57d6e605f81697fd12b8a1867300abf867429d57
```

---

## Judging Criteria Mapping

| Criterion | Weight | What to show |
|-----------|--------|--------------|
| **Real-World Utility** | 50% | Live audit of a deployed contract · Walrus blob verifiable by anyone · MVR on-chain linkage · Seal-encrypted findings |
| **UX & Product** | 20% | 6-stage animated stepper · Risk grade + severity chips · Expandable findings with confidence bars · Trust panel |
| **Technical Excellence** | 20% | 93 deterministic rules (zero cost) · OZ deviation checks · Seal IBE · Walrus quilt storage · MVR set_metadata PTB · GraphQL-only (JSON-RPC banned) |
| **Vision** | 10% | "Zero-cost deterministic-first security engine" — no LLM dependency · Fully on-chain audit trail · Layer 4 ML as optional bonus |
