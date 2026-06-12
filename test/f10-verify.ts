// F10 verification — all 4 steps
// Step 1: Run Layer 2 on overflow.move
// Step 2: Verify ML-OZ-001 fires with severity critical and confidence 0.95
// Step 3: Verify the Cetus-class finding sorts first in the report
// Step 4: Verify all 10 OZ rules are implemented and fire on deviation snippets

import * as fs from "fs";
import * as path from "path";
import { runLayer2, OZ_RULES } from "../src/lib/audit/layer2";
import { sortFindings } from "../src/lib/audit/engine";
import type { PackageContext } from "../src/lib/sui/queries";

function pass(msg: string) { console.log("PASS", msg); }
function fail(msg: string) { console.error("FAIL", msg); process.exit(1); }

const FIXTURES_DIR = path.join(__dirname, "fixtures");

function buildCtx(name: string, source: string): PackageContext {
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

/** Minimal deviation snippet for each OZ rule — one line of code that should trigger it. */
const DEVIATION_SNIPPETS: Record<string, string> = {
  "ML-OZ-001": "let mask: u256 = value << 64;",
  "ML-OZ-002": "let shifted: u64 = x >> 2;",
  "ML-OZ-003": "let result = (numerator * scale) / denom;",
  "ML-OZ-004": "let result = (a * b) >> 8;",
  "ML-OZ-005": "let avg = (x + y) / 2;",
  "ML-OZ-006": "let r = inv_mod(value, modulus);",
  "ML-OZ-007": "let root = isqrt(n);",
  "ML-OZ-008": "let lg = ilog2(n);",
  "ML-OZ-009": "let scaled = amount * 1000000000;",
  "ML-OZ-010": "let fee = balance * percent / 100;",
};

async function main() {
  let passed = 0;

  // ── Step 1: Run Layer 2 on overflow.move ─────────────────────────────────

  const overflowSrc = fs.readFileSync(
    path.join(FIXTURES_DIR, "overflow.move"), "utf-8"
  );
  const overflowCtx = buildCtx("overflow", overflowSrc);
  const overflowFindings = runLayer2(overflowCtx);

  if (overflowFindings.length === 0) {
    fail("step1: runLayer2 returned zero findings on overflow.move");
  }

  console.log(
    `       overflow.move L2 findings: [${overflowFindings
      .map((f) => `${f.rule_id}@L${f.line_start}`)
      .join(", ")}]`
  );

  pass(`step1: Layer 2 ran on overflow.move → ${overflowFindings.length} finding(s)`);
  passed++;

  // ── Step 2: ML-OZ-001 fires with severity critical and confidence 0.95 ───

  const oz001 = overflowFindings.filter((f) => f.rule_id === "ML-OZ-001");
  if (oz001.length === 0) {
    fail(
      `step2: ML-OZ-001 did NOT fire on overflow.move.\n` +
      `  Got: [${overflowFindings.map((f) => f.rule_id).join(", ")}]`
    );
  }

  for (const f of oz001) {
    if (f.severity !== "critical") {
      fail(`step2: ML-OZ-001 severity="${f.severity}", expected "critical"`);
    }
    if (Math.abs(f.confidence - 0.95) > 0.001) {
      fail(`step2: ML-OZ-001 confidence=${f.confidence}, expected 0.95`);
    }
    if (f.source !== "layer2") {
      fail(`step2: ML-OZ-001 source="${f.source}", expected "layer2"`);
    }
    console.log(
      `       ML-OZ-001: severity=${f.severity}, confidence=${f.confidence}, ` +
      `source=${f.source}, line=${f.line_start}`
    );
  }

  pass(`step2: ML-OZ-001 fires with severity=critical, confidence=0.95, source=layer2`);
  passed++;

  // ── Step 3: Cetus-class finding sorts first ───────────────────────────────
  //
  // Build a mixed list: ML-OZ-001 (Cetus-class, critical) and ML-ACC-001
  // (critical, from L1). sortFindings must put ML-OZ-001 first.

  const mockFindings = [
    {
      rule_id: "ML-ACC-001", severity: "critical" as const, confidence: 1.0,
      source: "layer1" as const, module: "m", line_start: 1, line_end: 1,
      description: "d", recommendation: "r", category: "access_control",
    },
    {
      rule_id: "ML-OZ-001", severity: "critical" as const, confidence: 0.95,
      source: "layer2" as const, module: "m", line_start: 5, line_end: 5,
      description: "d", recommendation: "r", category: "integer_overflow",
    },
    {
      rule_id: "ML-INT-001", severity: "critical" as const, confidence: 1.0,
      source: "layer1" as const, module: "m", line_start: 10, line_end: 10,
      description: "d", recommendation: "r", category: "integer_overflow",
    },
  ];

  const sorted = sortFindings(mockFindings);

  // ML-INT-001 and ML-OZ-001 are both Cetus-class — both should precede ML-ACC-001
  const cetusFindingIds = new Set(["ML-INT-001", "ML-OZ-001"]);
  const firstNonCetus = sorted.findIndex((f) => !cetusFindingIds.has(f.rule_id));
  const firstCetusCount = firstNonCetus === -1 ? sorted.length : firstNonCetus;

  if (firstCetusCount < 2) {
    fail(
      `step3: Cetus-class findings not sorted first.\n` +
      `  Sorted order: [${sorted.map((f) => f.rule_id).join(", ")}]`
    );
  }

  console.log(
    `       Sort order: [${sorted.map((f) => f.rule_id).join(", ")}] — ` +
    `Cetus-class in first ${firstCetusCount} positions ✓`
  );

  pass(`step3: Cetus-class findings (ML-INT-001, ML-OZ-001) sort before all others`);
  passed++;

  // ── Step 4: All 10 OZ rules implemented and fire on deviation snippets ────

  if (OZ_RULES.length !== 10) {
    fail(`step4: Expected 10 OZ rules, got ${OZ_RULES.length}`);
  }

  const expectedIds = [
    "ML-OZ-001", "ML-OZ-002", "ML-OZ-003", "ML-OZ-004", "ML-OZ-005",
    "ML-OZ-006", "ML-OZ-007", "ML-OZ-008", "ML-OZ-009", "ML-OZ-010",
  ];

  // Verify each rule has the expected ID and ML-OZ-001 is first
  for (let i = 0; i < expectedIds.length; i++) {
    if (OZ_RULES[i].id !== expectedIds[i]) {
      fail(`step4: OZ_RULES[${i}].id="${OZ_RULES[i].id}", expected "${expectedIds[i]}"`);
    }
  }

  if (OZ_RULES[0].id !== "ML-OZ-001") {
    fail(`step4: OZ_RULES[0].id="${OZ_RULES[0].id}" — ML-OZ-001 must be first`);
  }

  // Unit-test each rule against its deviation snippet
  let allFired = true;
  for (const ruleId of expectedIds) {
    const snippet = DEVIATION_SNIPPETS[ruleId];
    if (!snippet) {
      fail(`step4: No deviation snippet defined for ${ruleId}`);
      return;
    }

    const ctx = buildCtx("deviation_test", snippet);
    const findings = runLayer2(ctx);
    const hit = findings.find((f) => f.rule_id === ruleId);

    if (hit) {
      console.log(`       ${ruleId}: fires on snippet "${snippet.slice(0, 50)}" ✓`);
    } else {
      console.error(`       ${ruleId}: DID NOT fire on snippet "${snippet}"`);
      allFired = false;
    }
  }

  if (!allFired) {
    fail("step4: One or more OZ rules failed to fire on their deviation snippet");
  }

  pass(`step4: all 10 OZ rules implemented and fire on deviation snippets`);
  passed++;

  // ── Summary ───────────────────────────────────────────────────────────────

  console.log(`\nF10: ${passed}/4 steps passed ✓`);
  console.log(`OZ rules: ${OZ_RULES.map((r) => r.id).join(", ")}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
