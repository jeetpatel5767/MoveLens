# MoveLens — AI-Powered Sui Move Security Auditor

> **Sui Overflow 2026 · Walrus Specialized Track**

MoveLens is a zero-cost, 4-layer security engine for Sui Move smart contracts.
Paste a package address or upload source code — get an encrypted, permanently-stored
audit report in under 2 minutes.

---

## Why MoveLens?

Most security tools call an LLM and hope for the best. MoveLens uses a **deterministic-first**
hybrid engine that is cheap, fast, and auditable:

```
Layer 1 — 93 deterministic regex + AST rules (confidence: 1.0, cost: $0)
Layer 2 — 10 OpenZeppelin deviation checks, Cetus-class patterns (confidence: 0.95, cost: $0)
Layer 3 — MemWal agent memory: recall similar past exploits (confidence: variable)
Layer 4 — ML ensemble (Jina embeddings + DeepSeek classifier) via local sidecar (cost: $0)
```

Findings are **Seal-encrypted** so only the owner can read the full report.
The encrypted quilt (report.json + findings.enc + summary.md) is stored on **Walrus**
for permanent on-chain provenance. The blob ID is attached to the package in **MVR**.

---

## Architecture

```
Browser / CLI
    │
    ▼
POST /api/audit
    │
    ├─► fetchPackage (Sui GraphQL — never JSON-RPC)
    │       └─► resolvePackageName (MVR reverse-resolution)
    │
    ├─► runAudit
    │       ├─► Layer 1: 93 deterministic rules
    │       ├─► Layer 2: 10 OZ deviation checks
    │       ├─► Layer 3: MemWal recall (past exploit patterns)
    │       └─► Layer 4: ML sidecar (port 8765, deferred)
    │
    ├─► encryptReport (Seal IBE threshold encryption)
    │
    ├─► buildQuilt + uploadAuditQuilt (Walrus testnet, 5 epochs)
    │
    └─► attachAuditToPackage (MVR set_metadata, demo pkg only)

GET /api/audit?id= ─► job status + stagesVisited[]
GET /api/report/[id] ─► full report JSON + findings
```

---

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Framework | Next.js 15 (App Router, TypeScript) |
| Styling | Tailwind CSS v4 |
| Blockchain | Sui testnet — GraphQL only (`@mysten/sui/graphql`) |
| Storage | Walrus testnet (`@mysten/walrus@1.1.7`, WASM) |
| Encryption | Seal IBE (`@mysten/seal`) |
| Registry | MVR / PackageInfo on-chain metadata |
| Memory | MemWal agent memory (`@mysten-incubation/memwal`) |
| ML sidecar | Python · sentence-transformers · LanceDB (port 8765) |

---

## Setup (under 5 minutes)

### Prerequisites

- Node.js 20+ and npm
- A funded Sui **testnet** keypair (for Walrus uploads and MVR linking)

### Steps

```bash
# 1. Clone
git clone <repo-url> movelens
cd movelens

# 2. Install dependencies
npm install

# 3. Configure environment
cp .env.example .env
```

Edit `.env` and fill in:

| Variable | How to get it |
|----------|--------------|
| `SUI_KEYPAIR_B64` | `sui keytool export --key-identity <alias> --json` then base64 the output |
| `GROQ_API_KEY` | Free at [console.groq.com](https://console.groq.com) (Layer 4 only) |

The other variables (`SUI_GRAPHQL_URL`, `SUI_NETWORK`, etc.) are pre-filled with working testnet defaults.

```bash
# 4. Health check (starts dev server automatically if not running)
./init.sh

# 5. Open the app
open http://localhost:3000
```

### Quick audit

1. Go to `http://localhost:3000`
2. Click **Paste Source**, paste any `.move` file
3. Click **Run Audit**
4. Watch the 6-stage pipeline stepper
5. View findings grouped by severity with confidence bars and recommendations
6. Trust panel shows: Walrus blob ID link, Seal badge, MVR TX digest

---

## Demo Package

A pre-deployed demo vault contract lives on Sui testnet:

- **Package ID**: `0x6bcb6936da7f7df80741e0abb7aa5fb78d160a7be227f48b0a6f0c9c83648698`
- **PackageInfo**: `0xcc7af44f578839df65cd69705c640559aa594b6528161653b91416cdec7a50e2`
- **Pre-recorded blob**: `lFiTFEnn-pRmpu4kfLnC1w0dLoiWR4MvWW5Wbu4UuM8`

Paste the package ID in the address tab to audit it live, or view the pre-recorded blob directly:
[aggregator.walrus-testnet.walrus.space/v1/blobs/lFiTFEnn-pRmpu4kfLnC1w0dLoiWR4MvWW5Wbu4UuM8](https://aggregator.walrus-testnet.walrus.space/v1/blobs/lFiTFEnn-pRmpu4kfLnC1w0dLoiWR4MvWW5Wbu4UuM8)

### Intentional vulnerabilities in the demo vault

The demo package contains intentional audit targets:

| Finding | Rule | Severity |
|---------|------|----------|
| Integer overflow in `deposit()` | `ML-INT-001` | Critical |
| Unchecked arithmetic in fee calculation | `ML-OZ-001` | Critical |
| AdminCap emergency drain (no access control) | `ML-ACC-008` | High |
| Upgradeable contract without cap guard | `ML-UPG-001` | Medium |

---

## Running Tests

```bash
# Individual feature tests
npx tsx test/f19-verify.ts    # Audit API (async pipeline)
npx tsx test/f20-verify.ts    # Landing page (Playwright)
npx tsx test/f21-verify.ts    # Report page (Playwright)

# All earlier layer tests
npx tsx test/f08-verify.ts    # Layer 1 deterministic rules
npx tsx test/f14-verify.ts    # Walrus upload + fetch
```

---

## Layer 4 (Optional — deferred)

Layer 4 adds ML-powered vulnerability detection via a local Python sidecar.
It is deferred until all Phases 1–5 pass (per `BRIEFING.md`).

```bash
# Install Python deps
pip install -r requirements.txt

# Seed LanceDB corpus
npx tsx scripts/seedLanceDB.ts

# Start sidecar
python scripts/layer4_server.py
```

---

## Beyond the Hackathon

MoveLens is free for open-source Move projects today — all AI layers run locally
(DeepSeek-1.3B via Ollama, Jina embeddings) or on free tiers (Groq). Zero marginal
cost per audit.

Potential paths to sustainability:

- **CI integration**: a GitHub Action that runs MoveLens on every PR to a Move package,
  posting Layer 1 findings as a review comment — the natural extension of the
  "audit before you ship" workflow this tool already enables.
- **Ecosystem infrastructure**: the Walrus + Seal + MVR combination used here is a
  general pattern for on-chain-verifiable, privacy-respecting attestations — applicable
  beyond security audits (code quality scores, compliance checks, dependency audits).
- **Managed tier**: for teams wanting faster Layer 4 inference (larger models, dedicated
  compute) or private corpora, a hosted option could fund continued development while
  the local/free path remains available to all.

---

## Watermark

All audit reports carry the watermark:

> **Automated pre-screen — not a substitute for a human audit.**

---

*Built for Sui Overflow 2026 — Walrus Specialized Track.*
