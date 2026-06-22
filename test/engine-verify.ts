// Quick verify: engine flow produces correct scores
// Clean code → high score, vulnerable code → low score
// Gate fallback (no Groq) → score=100 (nothing confirmed)

import { runLayer1 } from "../src/lib/audit/layer1";
import { runLayer2 } from "../src/lib/audit/layer2";
import { computeScore, sortFindings, mergeFindings } from "../src/lib/audit/engine";
import type { GateResult } from "../src/lib/audit/gate";
import type { PackageContext } from "../src/lib/sui/queries";

function pass(msg: string) { console.log("PASS", msg); }
function fail(msg: string) { console.error("FAIL", msg); process.exit(1); }

function makeCtx(name: string, source: string): PackageContext {
  return {
    packageId:    `local-${name}`,
    network:      "testnet",
    mvrName:      null,
    sourceRepo:   null,
    version:      1,
    upgradeCount: 0,
    modules:      [{ name, source, disassembly: "" }],
    fetchedAt:    new Date().toISOString(),
  };
}

const CLEAN_CODE = `
module safe::treasury {
  use sui::object::UID;
  struct AdminCap has key { id: UID }
  fun init(ctx: &mut sui::tx_context::TxContext) {}
  fun deposit(amount: u64): u64 { amount }
  fun withdraw(_cap: &AdminCap, amount: u64): u64 { amount }
}
`;

const VULN_CODE = `
module vuln::pool {
  use sui::object::UID;
  struct Pool has key { id: UID, balance: u64 }
  public fun drain(pool: &mut Pool, amount: u64) {
    pool.balance = pool.balance - amount;
  }
  public fun unsafe_shift(x: u256): u256 {
    let mask: u256 = 0xffffffffffffffff << 192;
    x << 64
  }
}
`;

const EMPTY_GATE: GateResult = { confirmed: [], dismissed: [], unreviewed: [] };

async function main() {
  // ── Test 1: clean code → no confirmed findings → score=100 ──────────────
  const cleanCtx       = makeCtx("clean", CLEAN_CODE);
  const cleanSuspects  = runLayer1(cleanCtx);
  const cleanOz        = runLayer2(cleanCtx);

  // Simulate no Groq key: all suspects become unreviewed, none confirmed
  const cleanGate: GateResult = {
    confirmed:  [],
    dismissed:  [],
    unreviewed: cleanSuspects.map(s => ({ ...s, hint_reason: "no groq" })),
  };

  // Only OZ findings bypass the gate (none expected for clean code)
  const cleanFindings = sortFindings(mergeFindings(cleanOz)); // empty
  const cleanScore    = computeScore(cleanFindings, cleanGate);

  console.log(`Clean code: ${cleanSuspects.length} suspects, ${cleanOz.length} OZ findings, score=${cleanScore.overall} grade=${cleanScore.grade}`);

  if (cleanScore.overall < 90) {
    fail(`Test 1: clean code scored ${cleanScore.overall}, expected >= 90`);
  }
  pass(`Test 1: clean code with no confirmed findings scored ${cleanScore.overall} (${cleanScore.grade}) — PASS`);

  // ── Test 2: vulnerable code → suspects exist, but gate confirms none ─────
  // (simulate Groq unavailable — unreviewed score = 100, correctly "no accusation without confirmation")
  const vulnCtx      = makeCtx("vuln", VULN_CODE);
  const vulnSuspects = runLayer1(vulnCtx);
  const vulnOz       = runLayer2(vulnCtx);

  const vulnGateNoGroq: GateResult = {
    confirmed:  [],
    dismissed:  [],
    unreviewed: vulnSuspects.map(s => ({ ...s, hint_reason: "no groq" })),
  };

  // OZ findings bypass the gate — ML-OZ-001 should fire on the << operator
  const vulnFindingsNoGroq = sortFindings(mergeFindings(vulnOz));
  const vulnScoreNoGroq    = computeScore(vulnFindingsNoGroq, vulnGateNoGroq);

  console.log(`Vuln (no Groq): ${vulnSuspects.length} suspects, ${vulnOz.length} OZ findings, score=${vulnScoreNoGroq.overall}`);

  if (vulnOz.length === 0) {
    fail("Test 2: expected at least 1 OZ finding (ML-OZ-001) for u256 << in vulnerable code");
  }
  if (vulnScoreNoGroq.overall >= 100) {
    fail(`Test 2: OZ findings should reduce score below 100; got ${vulnScoreNoGroq.overall}`);
  }
  pass(`Test 2: OZ findings bypass gate and reduce score to ${vulnScoreNoGroq.overall} (no Groq needed for Layer 2) — PASS`);

  // ── Test 3: simulate Groq confirming all suspects on vulnerable code ─────
  const vulnGateConfirmAll: GateResult = {
    confirmed:  vulnSuspects.map(s => ({
      rule_id:          s.rule_id,
      severity:         s.severity,
      confidence:       0.85,
      confidence_reason: "Groq confirmed",
      source:           "layer1_confirmed" as const,
      module:           s.module,
      line_start:       s.line_start,
      line_end:         s.line_end,
      description:      s.description,
      recommendation:   s.recommendation,
      category:         s.category,
      impacted_code:    s.impacted_code,
      patch_before:     null,
      patch_after:      null,
      groq_reasoning:   "Confirmed: unguarded state mutation",
    })),
    dismissed:  [],
    unreviewed: [],
  };

  const vulnFindingsConfirmed = sortFindings(mergeFindings([
    ...vulnGateConfirmAll.confirmed,
    ...vulnOz,
  ]));
  const vulnScoreConfirmed = computeScore(vulnFindingsConfirmed, vulnGateConfirmAll);

  console.log(`Vuln (confirmed): ${vulnFindingsConfirmed.length} findings, score=${vulnScoreConfirmed.overall} grade=${vulnScoreConfirmed.grade}`);

  if (vulnScoreConfirmed.overall >= 75) {
    fail(`Test 3: vulnerable code with confirmed findings scored ${vulnScoreConfirmed.overall}, expected < 75 (grade B or worse)`);
  }
  pass(`Test 3: vulnerable code with confirmed findings scored ${vulnScoreConfirmed.overall} (${vulnScoreConfirmed.grade}) — PASS`);

  // ── Test 4: false_positive_rate is correct ──────────────────────────────
  const mixedGate: GateResult = {
    confirmed:  [vulnGateConfirmAll.confirmed[0]!],
    dismissed:  [{ rule_id: "ML-ACC-001", title: "...", location: { module: "x", function: null, line_start: 1, line_end: 1 }, reason: "getter function" }],
    unreviewed: [],
  };
  const mixedScore = computeScore([], mixedGate);

  const expectedFpRate = 1 / (1 + 1); // 1 dismissed / (1 confirmed + 1 dismissed) = 0.5
  if (Math.abs(mixedScore.false_positive_rate - expectedFpRate) > 0.01) {
    fail(`Test 4: false_positive_rate=${mixedScore.false_positive_rate}, expected ~${expectedFpRate}`);
  }
  pass(`Test 4: false_positive_rate=${mixedScore.false_positive_rate} (expected 0.5) — PASS`);

  // ── Test 5: score dimensions populated ─────────────────────────────────
  const dims = vulnScoreConfirmed.dimensions;
  const allDimsBetween0And100 = Object.values(dims).every(v => v >= 0 && v <= 100);
  if (!allDimsBetween0And100) {
    fail(`Test 5: dimensions out of range: ${JSON.stringify(dims)}`);
  }
  pass(`Test 5: dimensions all 0-100: ${JSON.stringify(dims)} — PASS`);

  console.log("\n✓ engine-verify: 5/5 tests passed");
}

main().catch(e => { console.error(e); process.exit(1); });
