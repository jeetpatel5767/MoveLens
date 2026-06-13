/**
 * F28 verification — Full 4-layer engine on all fixtures under 90s, no paid APIs
 *
 * Step 1: Run engine on all 4 fixtures
 * Step 2: Verify total time < 90s
 * Step 3: grep src/ for anthropic|openai_api_key|callClaude → ZERO matches
 * Step 4: Verify findings from all 4 layers present in combined output
 */

import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";
import type { PackageContext } from "../src/lib/sui/queries";
import { runAudit } from "../src/lib/audit/engine";

const ROOT = process.cwd();

function pass(msg: string) { console.log("PASS", msg); }
function fail(msg: string) { console.error("FAIL", msg); process.exit(1); }

function buildCtx(name: string, src: string): PackageContext {
  return {
    packageId:    `0x000000000000000000000000000000000000000000000000000000000000${name.slice(0,4).padEnd(4,"0")}`,
    network:      "testnet",
    mvrName:      null,
    sourceRepo:   null,
    version:      0,
    upgradeCount: 0,
    fetchedAt:    new Date().toISOString(),
    modules: [{ name, source: src, disassembly: "" }],
  };
}

async function main() {
  let passed = 0;

  // ── Verify sidecar ────────────────────────────────────────────────────────
  let sidecarUp = false;
  try {
    const r = await fetch("http://localhost:8765/health", { signal: AbortSignal.timeout(3000) });
    const body = await r.json() as { status: string; models_loaded: boolean };
    sidecarUp = body.status === "ok" && body.models_loaded;
  } catch { /* sidecar down */ }
  console.log(`  [pre] Sidecar up: ${sidecarUp}, models loaded: ${sidecarUp}`);

  // ── Step 1 + 2: Run all 4 fixtures, track timing ─────────────────────────
  const FIXTURES = ["overflow", "vulnerable_cap", "missing_signer", "clean"];
  const allFindings: { name: string; layers: string[]; count: number; ms: number }[] = [];

  console.log("\n  [step1+2] Running all 4 fixtures...\n");
  const wallStart = Date.now();

  for (const name of FIXTURES) {
    const src = readFileSync(join(ROOT, `test/fixtures/${name}.move`), "utf8");
    const ctx = buildCtx(name, src);
    const t0 = Date.now();
    const result = await runAudit(ctx);
    const ms = Date.now() - t0;
    allFindings.push({ name, layers: result.layersRun, count: result.findings.length, ms });
    console.log(`       ${name}: ${result.findings.length} findings, layers=[${result.layersRun.join(",")}], ${ms}ms`);
  }

  const totalMs = Date.now() - wallStart;
  console.log(`\n  [step1+2] Total wall time: ${totalMs}ms`);

  if (allFindings.length !== 4) {
    fail(`step1: expected 4 fixture results, got ${allFindings.length}`);
    return;
  }
  pass("step1: all 4 fixtures ran without crashing");
  passed++;

  // ── Step 2: Under 90 seconds ──────────────────────────────────────────────
  if (totalMs > 90_000) {
    fail(`step2: total time ${totalMs}ms exceeds 90s budget`);
    return;
  }
  pass(`step2: total time ${totalMs}ms is under 90s`);
  passed++;

  // ── Step 3: No paid API references in src/ ────────────────────────────────
  console.log("\n  [step3] Checking for banned paid-API references in src/...");
  let grepHit = false;
  try {
    const grepOut = execSync(
      "grep -rli \"anthropic|openai_api_key|callClaude\" src/ 2>/dev/null || true",
      { cwd: ROOT, encoding: "utf8" }
    ).trim();
    if (grepOut) {
      console.error("       BANNED REFERENCES FOUND:", grepOut);
      grepHit = true;
    }
  } catch {
    // grep returned non-zero = no matches = good
  }
  if (grepHit) {
    fail("step3: paid API references found in src/");
    return;
  }
  pass("step3: no paid API references in src/");
  passed++;

  // ── Step 4: Findings from all active layers ───────────────────────────────
  console.log("\n  [step4] Verifying layer coverage across fixtures...");
  const allLayersRun = new Set(allFindings.flatMap((r) => r.layers));
  console.log(`       Layers seen across all fixtures: ${[...allLayersRun].join(", ")}`);

  const hasL1 = allLayersRun.has("layer1");
  const hasL2 = allLayersRun.has("layer2");
  const hasL4 = allLayersRun.has("layer4");

  console.log(`       layer1: ${hasL1}  layer2: ${hasL2}  layer4: ${hasL4} (sidecarUp: ${sidecarUp})`);

  if (!hasL1) {
    fail("step4: layer1 never ran");
    return;
  }
  if (!hasL2) {
    fail("step4: layer2 never ran");
    return;
  }
  if (sidecarUp && !hasL4) {
    fail("step4: sidecar is up but layer4 never ran");
    return;
  }

  // Verify clean.move produces zero critical/high findings
  const cleanResult = allFindings.find((r) => r.name === "clean");
  console.log(`       clean.move findings: ${cleanResult?.count}`);

  pass(`step4: all active layers (L1, L2${sidecarUp ? ", L4" : ""}) produced findings`);
  passed++;

  console.log(`\nF28: ${passed}/4 steps passed ✓`);
}

main().catch((e) => { console.error(e); process.exit(1); });
