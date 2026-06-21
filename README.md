# MoveLens — AI-Powered Sui Move Security Auditor

> **Sui Overflow 2026 · Walrus Specialized Track**

**Live:** [http://16.171.224.235:3000](http://16.171.224.235:3000) · **Docs:** [movelens.mintlify.io](https://movelens.mintlify.io) · **MCP:** [Setup guide](https://movelens.mintlify.io/mcp/setup)

MoveLens is a 4-layer hybrid security engine for Sui Move smart contracts. Paste a package address, upload source code, or point at a GitHub repo — get a severity-ranked, encrypted, permanently stored audit report in under 60 seconds.

---

## How it works

```
Input (package address / Move source / GitHub URL)
  │
  ├─ Layer 1: 65 deterministic regex rules → findings (confidence 1.0, cost $0)
  ├─ Layer 2: 10 OpenZeppelin deviation checks → findings (confidence 0.95, cost $0)
  ├─ Layer 3: LanceDB semantic recall → similar past exploits injected into Layer 4
  └─ Layer 4: Groq llama-3.3-70b-versatile → ML classification (free tier)
       │
       └─ Merge + dedupe + severity sort
            │
            └─ Seal-encrypt findings → Walrus quilt (permanent blob) → MVR attestation
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 15, TypeScript, Tailwind CSS v4 |
| Blockchain | Sui GraphQL (`@mysten/sui`) — no JSON-RPC |
| Storage | Walrus testnet (`@mysten/walrus`) |
| Encryption | Seal IBE (`@mysten/seal`) |
| Registry | MVR on-chain metadata |
| Vector memory | LanceDB + Python sidecar (port 8765) |
| ML | Groq `llama-3.3-70b-versatile` (free tier) + Jina embeddings |
| MCP | HTTP endpoint at `/api/mcp` — one URL, zero install |

---

## MCP Integration

Connect to Claude Desktop or Claude Code in one step:

**Claude Desktop** — add to `claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "movelens": {
      "url": "http://16.171.224.235:3000/api/mcp"
    }
  }
}
```

**Claude Code:**
```bash
claude mcp add --transport http movelens http://16.171.224.235:3000/api/mcp
```

Three tools become available: `audit_move_source`, `audit_package_id`, `audit_github_repo`.

---

## Self-hosting

### Prerequisites
- Node.js 20+, Python 3.10+
- Funded Sui testnet keypair (for Walrus uploads)
- Free Groq API key (Layer 4, optional)

### Run locally

```bash
git clone https://github.com/jeetpatel5767/movelens.git
cd movelens
npm install
cp .env.example .env   # fill in SUI_KEYPAIR_B64 and GROQ_API_KEY

# Start Python sidecar (Layer 3 + 4)
pip install -r requirements.txt
npx tsx scripts/seedLanceDB.ts
python scripts/layer4_server.py &

# Start Next.js
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Docker

```bash
docker build -t movelens .
docker run -d -p 3000:3000 --env-file .env --name movelens movelens
```

---

## Key rules

- 65 Layer 1 regex rules across 13 vulnerability sectors
- 10 Layer 2 OpenZeppelin deviation benchmarks
- ML-INT-001 detects the Cetus-class bit-shift overflow ($223M, May 2025)
- All findings carry a watermark: *"Automated pre-screen — not a substitute for a human audit."*
- Zero paid AI APIs in the audit engine — Groq free tier only, with keyword fallback

---

*Built for Sui Overflow 2026 — Walrus Specialized Track.*
