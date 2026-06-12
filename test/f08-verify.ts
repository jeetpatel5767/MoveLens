// F08 verification — all 4 steps
// Step 1: Run Layer 1 on vulnerable_cap.move — ML-ACC-008 + ML-UPG-001, confidence=1.0, source=layer1
// Step 2: Run on missing_signer.move + overflow.move — all expected rule_ids appear
// Step 3: Run on clean.move — zero critical or high findings
// Step 4: Every emitted finding validates against FindingSchema

import * as fs from "fs";
import * as path from "path";
import { runLayer1 } from "../src/lib/audit/layer1";
import { FindingSchema } from "../src/lib/audit/schema";
import type { PackageContext } from "../src/lib/sui/queries";

function pass(msg: string) { console.log("PASS", msg); }
function fail(msg: string) { console.error("FAIL", msg); process.exit(1); }

const FIXTURES_DIR = path.join(__dirname, "fixtures");

/** Build a minimal PackageContext from a local .move source string. */
function buildCtx(fixtureName: string, source: string): PackageContext {
  return {
    packageId:    `local-${fixtureName}`,
    network:      "testnet",
    mvrName:      null,
    sourceRepo:   null,
    version:      1,
    upgradeCount: 0,
    modules:      [{ name: fixtureName, source, disassembly: "" }],
    fetchedAt:    new Date().toISOString(),
  };
}

function loadExpected(name: string): { must_find: string[]; must_not_find_above: string | null } {
  const p = path.join(FIXTURES_DIR, name, "expected.json");
  return JSON.parse(fs.readFileSync(p, "utf-8")) as {
    must_find: string[];
    must_not_find_above: string | null;
  };
}

function readFixture(name: string): string {
  return fs.readFileSync(path.join(FIXTURES_DIR, `${name}.move`), "utf-8");
}

async function main() {
  let passed = 0;

  // ── Step 1: vulnerable_cap.move ───────────────────────────────────────────

  const vcSrc      = readFixture("vulnerable_cap");
  const vcCtx      = buildCtx("vulnerable_cap", vcSrc);
  const vcFindings = runLayer1(vcCtx);
  const vcExpected = loadExpected("vulnerable_cap");

  for (const requiredId of vcExpected.must_find) {
    const hit = vcFindings.find((f) => f.rule_id === requiredId);
    if (!hit) {
      fail(
        `step1: vulnerable_cap.move missing expected finding ${requiredId}.\n` +
        `  Got: [${vcFindings.map((f) => f.rule_id).join(", ")}]`
      );
    }
    if (hit!.confidence !== 1.0) {
      fail(`step1: ${requiredId} confidence=${hit!.confidence}, expected 1.0`);
    }
    if (hit!.source !== "layer1") {
      fail(`step1: ${requiredId} source="${hit!.source}", expected "layer1"`);
    }
    console.log(`       ${requiredId}: line ${hit!.line_start}–${hit!.line_end}, confidence=1.0, source=layer1 ✓`);
  }

  pass(
    `step1: vulnerable_cap.move → [${vcExpected.must_find.join(", ")}] ` +
    `with confidence=1.0, source=layer1`
  );
  passed++;

  // ── Step 2: missing_signer.move + overflow.move ───────────────────────────

  for (const name of ["missing_signer", "overflow"] as const) {
    const src      = readFixture(name);
    const ctx      = buildCtx(name, src);
    const findings = runLayer1(ctx);
    const expected = loadExpected(name);

    for (const requiredId of expected.must_find) {
      const hit = findings.find((f) => f.rule_id === requiredId);
      if (!hit) {
        fail(
          `step2: ${name}.move missing expected finding ${requiredId}.\n` +
          `  Got: [${findings.map((f) => f.rule_id).join(", ")}]`
        );
      }
      console.log(`       ${name}: ${requiredId} @ line ${hit!.line_start} ✓`);
    }
  }

  pass(`step2: missing_signer.move + overflow.move → all expected rule_ids found`);
  passed++;

  // ── Step 3: clean.move — zero critical / high ─────────────────────────────

  const cleanSrc      = readFixture("clean");
  const cleanCtx      = buildCtx("clean", cleanSrc);
  const cleanFindings = runLayer1(cleanCtx);

  const critOrHigh = cleanFindings.filter(
    (f) => f.severity === "critical" || f.severity === "high"
  );

  if (critOrHigh.length > 0) {
    fail(
      `step3: clean.move produced ${critOrHigh.length} critical/high finding(s):\n` +
      critOrHigh
        .map((f) => `  ${f.rule_id} [${f.severity}] @ line ${f.line_start}: ${f.description.slice(0, 80)}`)
        .join("\n")
    );
  }

  if (cleanFindings.length > 0) {
    console.log(
      `       clean.move medium/low only (OK): [${cleanFindings
        .map((f) => `${f.rule_id}@L${f.line_start}`)
        .join(", ")}]`
    );
  } else {
    console.log(`       clean.move: zero findings`);
  }

  pass(`step3: clean.move → zero critical/high findings (${cleanFindings.length} total)`);
  passed++;

  // ── Step 4: every finding validates against FindingSchema ─────────────────

  const allFindings = [
    ...vcFindings,
    ...runLayer1(buildCtx("missing_signer", readFixture("missing_signer"))),
    ...runLayer1(buildCtx("overflow",       readFixture("overflow"))),
    ...cleanFindings,
  ];

  let schemaFailures = 0;
  for (const finding of allFindings) {
    const result = FindingSchema.safeParse(finding);
    if (!result.success) {
      console.error(
        `step4: SCHEMA FAIL for ${finding.rule_id}: ` +
        result.error.issues.map((i) => i.message).join("; ")
      );
      schemaFailures++;
    }
  }
  if (schemaFailures > 0) {
    fail(`step4: ${schemaFailures} finding(s) failed FindingSchema validation`);
  }

  pass(`step4: all ${allFindings.length} findings validate against FindingSchema`);
  passed++;

  // ── Summary ──────────────────────────────────────────────────────────────

  console.log(`\nF08: ${passed}/4 steps passed ✓`);
  console.log(
    `Findings: vulnerable_cap=${vcFindings.length}  ` +
    `missing_signer=${runLayer1(buildCtx("missing_signer", readFixture("missing_signer"))).length}  ` +
    `overflow=${runLayer1(buildCtx("overflow", readFixture("overflow"))).length}  ` +
    `clean=${cleanFindings.length}`
  );
}

main().catch((e) => { console.error(e); process.exit(1); });
