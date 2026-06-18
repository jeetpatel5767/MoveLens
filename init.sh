#!/usr/bin/env bash
# MoveLens — session health check + dev bootstrap.
# Run at the START of every Claude Code session, BEFORE writing any code.
# Exit code 0 = healthy base, safe to start a new feature.
# Non-zero    = the base is broken; fixing it is this session's task.

set -uo pipefail
FAIL=0
step() { printf "\n==> %s\n" "$1"; }
ok()   { printf "    OK: %s\n" "$1"; }
bad()  { printf "    FAIL: %s\n" "$1"; FAIL=1; }

step "1/8 Working directory"
pwd

step "2/8 Required harness files"
for f in CLAUDE.md IMPLEMENTATION.md features.json progress.txt; do
  [ -f "$f" ] && ok "$f present" || bad "$f MISSING"
done

step "3/8 features.json is valid JSON and untampered"
if command -v node >/dev/null 2>&1 && [ -f features.json ]; then
  node -e "
    const f = require('./features.json');
    if (!Array.isArray(f.features) || f.features.length < 28) {
      console.error('    FAIL: features array missing or shrunk (<28 entries) — features must NEVER be removed');
      process.exit(1);
    }
    const passing = f.features.filter(x => x.passes).length;
    console.log('    OK: ' + f.features.length + ' features, ' + passing + ' passing');
  " || FAIL=1
fi

step "4/8 Environment"
if [ -f .env ]; then
  ok ".env present"
else
  if [ -f .env.example ]; then
    bad ".env missing — copy .env.example to .env and fill keys"
  else
    ok "no env files yet (pre-Phase-1 state)"
  fi
fi

step "5/8 Dependencies + typecheck"
if [ -f package.json ]; then
  [ -d node_modules ] || { echo "    installing deps..."; npm install --no-audit --no-fund || bad "npm install failed"; }
  if npx tsc --noEmit 2>/dev/null; then ok "typecheck clean"; else bad "typecheck errors — fix before new features"; fi
else
  ok "no package.json yet (pre-Phase-1 state)"
fi

step "6/8 JSON-RPC ban (sunsets 2026-07-31 — GraphQL only)"
if [ -d src ]; then
  if grep -rli "jsonrpc" src/ >/dev/null 2>&1; then
    bad "JSON-RPC reference found in src/ — FORBIDDEN. Files:"; grep -rli "jsonrpc" src/
  else
    ok "no JSON-RPC references"
  fi
else
  ok "no src/ yet"
fi

step "7/8 Smoke test + dev server"
if [ -f test/smoke.ts ]; then
  if npx tsx test/smoke.ts; then ok "smoke test passed"; else bad "smoke test FAILED — fix before new features"; fi
else
  ok "no smoke test yet (created in Phase 2)"
fi
if [ -f package.json ] && grep -q '"dev"' package.json; then
  if ! curl -s -o /dev/null http://localhost:3000 2>/dev/null; then
    echo "    starting dev server in background..."
    nohup npm run dev >/tmp/movelens-dev.log 2>&1 &
    sleep 6
  fi
  curl -s -o /dev/null -w "" http://localhost:3000 && ok "dev server responding on :3000" || bad "dev server not responding (see /tmp/movelens-dev.log)"
fi

step "8/9 Zero-paid-API ban + Layer 4 (BRIEFING.md)"
if [ -d src ]; then
  if grep -rli "anthropic\|openai_api_key\|callClaude" src/ >/dev/null 2>&1; then
    bad "PAID API reference found in src/ — FORBIDDEN. Files:"; grep -rli "anthropic\|openai_api_key\|callClaude" src/
  else
    ok "no paid API references"
  fi
else
  ok "no src/ yet"
fi
if [ -f scripts/layer4_server.py ]; then
  if curl -s -o /dev/null http://localhost:8765/health 2>/dev/null; then
    ok "Layer 4 sidecar responding on :8765"
  else
    bad "Layer 4 sidecar NOT running — start it: python scripts/layer4_server.py (required before any audit once Layer 4 exists)"
  fi
  [ -d lancedb_store ] && ok "lancedb_store/ seeded" || bad "lancedb_store/ missing — run: npx tsx scripts/seedLanceDB.ts"
else
  ok "Layer 4 not built yet (deferred until Phases 1-5 green per BRIEFING.md)"
fi

step "9/9 Layer 3/4 readiness + gallery validity"

# Groq API key check
if [ -z "${GROQ_API_KEY:-}" ]; then
  bad "GROQ_API_KEY not set — Layer 4 will run in keyword-heuristic-only fallback mode (no real AI classification). Get a free key at console.groq.com"
else
  ok "GROQ_API_KEY configured — Layer 4 will use Groq llama-3.3-70b-versatile for classification"
fi

# LanceDB corpus size check via sidecar /health
if curl -s http://localhost:8765/health 2>/dev/null | grep -q '"corpus_rows"'; then
  ROWS=$(curl -s http://localhost:8765/health 2>/dev/null | node -e "process.stdin.once('data',d=>console.log(JSON.parse(d).corpus_rows))" 2>/dev/null)
  if [ -n "$ROWS" ] && [ "$ROWS" -ge 50 ] 2>/dev/null; then
    ok "LanceDB corpus has $ROWS rows (>= 50)"
  else
    bad "LanceDB corpus has only ${ROWS:-0} rows (< 50) — run: npx tsx scripts/seedLanceDB.ts"
  fi
fi

# Gallery validity
if [ -f src/app/gallery.json ]; then
  node -e "JSON.parse(require('fs').readFileSync('src/app/gallery.json','utf8'))" 2>/dev/null \
    && ok "gallery.json valid JSON" || bad "gallery.json INVALID JSON"
else
  bad "src/app/gallery.json missing — run: npx tsx scripts/gallery-audits.ts"
fi

echo ""
if [ "$FAIL" -eq 0 ]; then
  echo "RESULT: HEALTHY — pick ONE failing feature from features.json and begin."
else
  echo "RESULT: BROKEN — fixing the failures above IS this session's task. Do NOT start a new feature."
fi
exit $FAIL
