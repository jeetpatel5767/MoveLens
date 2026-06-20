# TASK_DEPLOY.md — Live Public URL on Render (Single Container)

> **Goal:** Get MoveLens on a real public URL for judges, before June 21.
> **Platform decision:** Render, ONE Web Service running Next.js + the Python sidecar
> together in a single Docker container. No credit card required. No Vercel/Railway
> split. The sidecar talks to Next.js over `localhost` — never exposed publicly.
>
> **Why not Vercel:** Vercel's serverless functions can't run a persistent Flask
> process, and your current async job pipeline (fire-and-forget background
> continuation + SQLite polling) assumes a long-running Node process — exactly
> what `next start` gives you, and exactly what Vercel does NOT give you without a
> rewrite. Render's free web services run as persistent containers, so the existing
> architecture works with ZERO pipeline rewrites.
>
> **Why not Railway:** Free trial requires no card upfront, but expires/needs a card
> within 30 days — unnecessary risk this close to a deadline you're trying to hit.
>
> **No new feature IDs.** This is infrastructure, not a feature.

---

## TASK F1 — Dockerfile (Node + Python combined)

**New file:** `Dockerfile` (project root)

```dockerfile
# Dockerfile — single container running Next.js + Python Layer 4 sidecar together

FROM node:20-slim

# Install Python + build tools (needed for sentence-transformers/torch/lancedb)
RUN apt-get update && apt-get install -y \
    python3 python3-pip python3-venv \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# --- Node deps ---
COPY package*.json ./
RUN npm install --production=false

# --- Python deps ---
COPY requirements.txt ./
RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"
RUN pip install --no-cache-dir -r requirements.txt

# --- App source ---
COPY . .

# Build Next.js for production
RUN npm run build

# Pre-download the Jina embedding model + pre-seed LanceDB AT BUILD TIME,
# so the container never has a slow "first request" cold-load in production.
# This requires network access during build (Render provides this).
RUN python3 scripts/seedLanceDB_standalone.py || echo "Seed script not found — verify Task F3 ran"

EXPOSE 3000
# Render injects $PORT — Next.js must bind to it, not a hardcoded 3000.
CMD ["./start.sh"]
```

**New file:** `.dockerignore`

```
node_modules
.env
.next
audits.db
lancedb_store
.git
*.log
```

---

## TASK F2 — `start.sh` (launches both processes in one container)

**New file:** `start.sh` (project root, must be executable)

```bash
#!/usr/bin/env bash
set -e

echo "Starting Layer 4 sidecar (background)..."
python3 scripts/layer4_server.py &
SIDECAR_PID=$!

# Wait for sidecar health before starting Next.js (max 60s)
echo "Waiting for sidecar health..."
for i in $(seq 1 30); do
  if curl -s http://127.0.0.1:8765/health > /dev/null 2>&1; then
    echo "Sidecar healthy after ${i}x2s."
    break
  fi
  sleep 2
done

echo "Starting Next.js on port ${PORT:-3000}..."
exec npm run start -- -p "${PORT:-3000}"

# If Next.js exits, also kill the sidecar (container should fully stop)
trap "kill $SIDECAR_PID" EXIT
```

- [ ] Make it executable: `chmod +x start.sh` (do this in the same commit)
- [ ] Verify `package.json`'s `"start"` script is `"next start"` (NOT `"next dev"`) —
      production builds must use `next start` against the `npm run build` output.

---

## TASK F3 — Bake LanceDB corpus into the image at build time

**Goal:** Free tier has no persistent disk, so the corpus must be re-seeded fresh on
every container build (not "remembered" across redeploys — acceptable for a demo).

**New file:** `scripts/seedLanceDB_standalone.py` (a Python-only version that runs
during `docker build`, since the existing `seedLanceDB.ts` is a TypeScript/Node
script and may depend on the sidecar already running, which it isn't yet at build time)

```python
# scripts/seedLanceDB_standalone.py
# Runs during `docker build` — seeds the SAME corpus content as seedLanceDB.ts,
# but standalone (loads Jina directly, no sidecar HTTP round-trip needed since
# the sidecar process doesn't exist yet at build time).
#
# IMPORTANT: read the corpus data source from wherever seedLanceDB.ts currently
# gets it (likely a hardcoded array or a JSON file) and reuse the SAME data —
# do not invent new corpus entries. If seedLanceDB.ts loads from a JSON file
# (e.g. scripts/corpus.json), just point this script at the same file.

import lancedb
from sentence_transformers import SentenceTransformer

print("Pre-downloading Jina embedding model for build-time seed...")
model = SentenceTransformer("jinaai/jina-embeddings-v2-base-code", trust_remote_code=True)

# Load the SAME corpus entries seedLanceDB.ts uses — adjust the import/load
# below to match however the existing script stores its source data:
import json
with open("scripts/corpus.json") as f:  # VERIFY this path matches the real source
    corpus = json.load(f)

rows = []
for entry in corpus:
    vec = model.encode(entry["code"], normalize_embeddings=True).tolist()
    rows.append({
        "name": entry["name"], "sector": entry["sector"],
        "severity": entry["severity"], "code": entry["code"],
        "from_audit": False, "vector": vec,
    })

db = lancedb.connect("./lancedb_store")
db.create_table("vuln_corpus", rows, mode="overwrite")
print(f"Seeded {len(rows)} corpus rows at build time.")
```

- [ ] **Before writing this script, inspect the REAL `seedLanceDB.ts` to find where
      its corpus data actually comes from** (inline array vs JSON file) and adjust
      the load path above to match exactly — do not guess or invent corpus content.

---

## TASK F4 — Production config

```typescript
// next.config.js (or .ts) — ensure output is NOT "export" (static) mode;
// this app needs a real Node server (API routes, SQLite, server-side fetches).
// If output: 'export' is set anywhere, remove it.
```

```json
// package.json — verify these scripts exist exactly:
// "build": "next build",
// "start": "next start"
```

```typescript
// src/lib/store/audits.ts — the existing SQLite path logic should already use
// `path.join(process.cwd(), "audits.db")` (per D2/F34). No code change needed —
// just document (see Task F6) that this file resets on every container restart
// on Render's free tier (no persistent disk). This is acceptable for a hackathon
// demo; do NOT add complexity to work around it under this deadline.
```

---

## TASK F5 — Env vars documentation (values entered manually, see bottom)

```bash
# .env.example — add a comment block noting these are required in Render's
# dashboard for the deployed instance (Render does NOT read your local .env file):

# === RENDER DEPLOYMENT — set these in the Render dashboard, not here ===
# SUI_GRAPHQL_URL, SUI_NETWORK, WALRUS_NETWORK, SUI_KEYPAIR_B64, GROQ_API_KEY,
# MEMWAL_ENABLED, DEMO_MODE_BLOB_ID, DEMO_PACKAGE_INFO_ID — all the same values
# as your local .env. LAYER4_SIDECAR_URL should be http://127.0.0.1:8765
# (the sidecar runs inside the SAME container, so localhost is correct here —
# do NOT use a Render public URL for this var).
```

---

## TASK F6 — Update README + demo.md with a placeholder

```markdown
# README.md — add near the top, just under the pitch:

**Live demo:** [PLACEHOLDER — fill in after Render deploy completes]

# scripts/demo.md — add a note in the "Backup Plan" section:
"If the live URL is cold (idle >15 min), the first request takes ~30-60s to wake
up. Visit the URL once, 5 minutes before presenting, to warm it up."
```

- [ ] Leave the URL as a literal placeholder string — it gets filled in during the
      MANUAL steps below, after the first successful deploy.

---

## Task F1-F6 — Verify (local, before pushing)

- [ ] `docker build -t movelens-test .` completes successfully on your machine
      (this tests the Dockerfile without needing Render at all first)
- [ ] `docker run -p 3000:3000 --env-file .env movelens-test` — visit
      `http://localhost:3000` and confirm the app loads
- [ ] Run a test audit against the dockerized container — confirm Layer 1-4 all
      fire correctly (sidecar started via `start.sh` inside the container)
- [ ] Confirm `start.sh` is executable in git (`git ls-files -s start.sh` should
      show mode `100755`, not `100644` — if not, run `chmod +x start.sh && git add start.sh`)

---

## MANUAL STEPS (you do these — Claude Code has no internet access)

1. **Push everything to GitHub** (if not already): `git push origin main`
2. **Create a free Render account** at https://render.com — no credit card needed
3. **New Web Service** → connect your GitHub repo → Render auto-detects the
   `Dockerfile` and offers a Docker-based deploy. Select the **Free** instance type.
4. **Set environment variables** in the Render dashboard (Settings → Environment) —
   copy every value from your local `.env` EXCEPT `LAYER4_SIDECAR_URL`, which
   should be `http://127.0.0.1:8765` (not a Render URL — sidecar is internal)
5. **Deploy.** First build will be slow (5-15 min — installing torch, sentence-
   transformers, downloading the Jina model). This is normal, only happens on
   deploy, not per-request.
6. **Get your public URL** from the Render dashboard (e.g.,
   `https://movelens-xyz.onrender.com`)
7. **Test it live:** open the URL in an incognito window, paste a test contract,
   run a full audit, confirm it completes (give it extra time on the FIRST
   request — cold start)
8. **Update README.md and scripts/demo.md** with the real URL (replace the
   placeholder from Task F6) — you can do this yourself or hand it back to
   Claude Code: `"Replace the README/demo.md placeholder URL with <your real URL>"`
9. **Before your actual judging slot:** visit the URL once, ~5 minutes ahead of
   time, so it's warm and doesn't cold-start in front of judges
