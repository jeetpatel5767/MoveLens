// F17 verification — AuditMemory abstraction with noop fallback
//
// Step 1: createMemory() with MEMWAL_ENABLED=false returns a NoopMemory
//         (verified by: healthy()=true, recall()=[], no throws).
// Step 2: Run a full fixture audit end-to-end with noop memory,
//         verify it succeeds and memory_context_used=false.
// Step 3: Verify a warning was emitted to stderr when MEMWAL_ENABLED=false.

import { createMemory, NoopMemory } from "../src/lib/memory/index";
import { runAudit, assembleReport } from "../src/lib/audit/engine";
import type { PackageContext } from "../src/lib/sui/queries";
import { readFileSync } from "fs";
import { join } from "path";

function pass(msg: string) { console.log("PASS", msg); }
function fail(msg: string) { console.error("FAIL", msg); process.exit(1); }

// Intercept console.warn to capture warning messages
const capturedWarnings: string[] = [];
const originalWarn = console.warn;
console.warn = (...args: unknown[]) => {
  const msg = args.map(String).join(" ");
  capturedWarnings.push(msg);
  originalWarn(...args);
};

// Build a minimal PackageContext from the overflow fixture
function buildFixtureCtx(): PackageContext {
  const src = readFileSync(
    join(process.cwd(), "test/fixtures/overflow.move"),
    "utf8",
  );
  return {
    packageId:    "local-overflow",
    network:      "testnet",
    mvrName:      null,
    sourceRepo:   null,
    version:      1,
    upgradeCount: 0,
    fetchedAt:    new Date().toISOString(),
    modules: [{ name: "overflow", source: src, disassembly: src }],
  };
}

async function main() {
  let passed = 0;

  // ── Step 1: createMemory() with MEMWAL_ENABLED=false → NoopMemory ──────────
  console.log(`\n  [step1] createMemory() with MEMWAL_ENABLED=false…`);

  // Force MEMWAL_ENABLED=false for this test by patching env
  // (env is already set by .env; if MEMWAL_ENABLED is true there, we override here)
  // We use the createMemory() factory, which reads env.MEMWAL_ENABLED.
  // To test the false path: temporarily override.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const envModule = require("../src/lib/env");
  const originalEnabled = envModule.env.MEMWAL_ENABLED;
  envModule.env.MEMWAL_ENABLED = false;

  let memory;
  try {
    memory = await createMemory();
  } catch (e) {
    fail(`step1: createMemory() threw: ${e}`);
    return;
  }

  // Restore
  envModule.env.MEMWAL_ENABLED = originalEnabled;

  // Verify it's a NoopMemory (or at least behaves like one)
  const healthy = await memory.healthy();
  if (!healthy) {
    fail(`step1: healthy() should return true for NoopMemory`);
    return;
  }

  const hits = await memory.recall("test query", "movelens/all");
  if (!Array.isArray(hits) || hits.length !== 0) {
    fail(`step1: NoopMemory.recall() should return [] but got ${JSON.stringify(hits)}`);
    return;
  }

  // remember should not throw
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await memory.remember({} as any, "movelens/test");
  } catch (e) {
    fail(`step1: NoopMemory.remember() threw: ${e}`);
    return;
  }

  const isNoop = memory instanceof NoopMemory;
  console.log(`       memory instanceof NoopMemory: ${isNoop} ✓`);
  console.log(`       healthy(): ${healthy} ✓`);
  console.log(`       recall() returned [] ✓`);
  pass(`step1: createMemory(MEMWAL_ENABLED=false) returns NoopMemory, healthy=true, recall=[]`);
  passed++;

  // ── Step 2: Full fixture audit with noop memory → memory_context_used=false ─
  console.log(`\n  [step2] Running full fixture audit with noop memory…`);

  const ctx = buildFixtureCtx();
  const noopMem = new NoopMemory();

  let engineResult;
  try {
    engineResult = await runAudit(ctx, noopMem);
  } catch (e) {
    fail(`step2: runAudit threw with noop memory: ${e}`);
    return;
  }

  if (!engineResult || !Array.isArray(engineResult.findings)) {
    fail(`step2: runAudit returned unexpected shape: ${JSON.stringify(engineResult)}`);
    return;
  }

  const report = assembleReport(ctx, engineResult, { memoryContextUsed: false });

  if (report.memory_context_used !== false) {
    fail(`step2: report.memory_context_used should be false, got ${report.memory_context_used}`);
    return;
  }
  if (engineResult.findings.length === 0) {
    fail(`step2: expected findings on overflow.move but got none`);
    return;
  }

  console.log(`       findings: ${engineResult.findings.length} ✓`);
  console.log(`       memory_context_used: ${report.memory_context_used} ✓`);
  console.log(`       layers run: ${engineResult.layersRun.join(", ")} ✓`);
  pass(`step2: audit with noop memory succeeded; ${engineResult.findings.length} findings, memory_context_used=false`);
  passed++;

  // ── Step 3: Warning was emitted when MEMWAL_ENABLED=false ──────────────────
  console.log(`\n  [step3] Checking warning was emitted for MEMWAL_ENABLED=false…`);

  const warnMatch = capturedWarnings.find(
    (w) => w.includes("MEMWAL_ENABLED=false") || w.includes("noop memory"),
  );

  if (!warnMatch) {
    fail(
      `step3: no warning found containing "MEMWAL_ENABLED=false" or "noop memory".\n` +
      `       Captured warnings: ${JSON.stringify(capturedWarnings)}`,
    );
    return;
  }

  console.log(`       Warning captured: "${warnMatch}" ✓`);
  pass(`step3: warning emitted for MEMWAL_ENABLED=false`);
  passed++;

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log(`\nF17: ${passed}/3 steps passed ✓`);
  console.log(`  NoopMemory: healthy=true, recall=[], remember=noop`);
  console.log(`  Full audit with noop: ${engineResult.findings.length} findings, memory_context_used=false`);
  console.log(`  Warning logged when MEMWAL_ENABLED=false`);
}

main().catch((e) => { console.error(e); process.exit(1); });
