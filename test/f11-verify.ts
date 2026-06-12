// F11 verification — all 4 steps
// Step 1: Assemble a report from fixture findings
// Step 2: Verify findings sorted critical-first, confidence descending within severity
// Step 3: Verify severity counts and A-F risk grade per the documented mapping
// Step 4: Verify watermark string present verbatim

import * as fs from "fs";
import * as path from "path";
import { runAudit, assembleReport, computeRiskGrade, computeSeverityCounts } from "../src/lib/audit/engine";
import { AuditReportSchema, WATERMARK } from "../src/lib/audit/schema";
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

function readFixture(name: string): string {
  return fs.readFileSync(path.join(FIXTURES_DIR, `${name}.move`), "utf-8");
}

async function main() {
  let passed = 0;

  // ── Step 1: Assemble a report from fixture findings ───────────────────────
  //
  // Use overflow.move — it produces multiple critical findings (ML-INT-001, ML-OZ-001).

  const overflowCtx    = buildCtx("overflow", readFixture("overflow"));
  const engineResult   = await runAudit(overflowCtx);
  const report         = assembleReport(overflowCtx, engineResult);

  // Basic structure checks
  if (!report.report_id.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
    fail(`step1: report_id is not a valid UUID: "${report.report_id}"`);
  }
  if (!report.generated_at || isNaN(Date.parse(report.generated_at))) {
    fail(`step1: generated_at is not a valid ISO datetime: "${report.generated_at}"`);
  }
  if (report.package.packageId !== "local-overflow") {
    fail(`step1: package.packageId="${report.package.packageId}", expected "local-overflow"`);
  }
  if (report.findings.length === 0) {
    fail("step1: assembled report has zero findings");
  }
  if (report.sealed !== false) {
    fail(`step1: sealed should be false immediately after assembly, got ${report.sealed}`);
  }

  // Validate the entire report against the Zod schema
  const parsed = AuditReportSchema.safeParse(report);
  if (!parsed.success) {
    fail(`step1: AuditReport failed schema validation:\n${JSON.stringify(parsed.error.issues, null, 2)}`);
  }

  console.log(
    `       report_id: ${report.report_id.slice(0, 8)}...  ` +
    `findings: ${report.findings.length}  ` +
    `risk_grade: ${report.risk_grade}`
  );

  pass(`step1: AuditReport assembled and validates against AuditReportSchema`);
  passed++;

  // ── Step 2: Findings sorted critical-first, confidence desc within severity ─

  const findings = report.findings;
  const CETUS_IDS = new Set(["ML-INT-001", "ML-OZ-001"]);

  // All Cetus-class findings must come before any non-Cetus
  let seenNonCetus = false;
  for (const f of findings) {
    if (!CETUS_IDS.has(f.rule_id)) {
      seenNonCetus = true;
    } else if (seenNonCetus) {
      fail(
        `step2: Cetus-class finding ${f.rule_id} appears after a non-Cetus finding.\n` +
        `  Order: [${findings.map((f) => f.rule_id).join(", ")}]`
      );
    }
  }

  // Within each severity bucket (excluding Cetus), confidence must be non-increasing
  const SEVERITY_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  const nonCetus = findings.filter((f) => !CETUS_IDS.has(f.rule_id));

  for (let i = 1; i < nonCetus.length; i++) {
    const prev = nonCetus[i - 1];
    const curr = nonCetus[i];
    const prevSev = SEVERITY_ORDER[prev.severity] ?? 99;
    const currSev = SEVERITY_ORDER[curr.severity] ?? 99;

    if (currSev < prevSev) {
      fail(
        `step2: Severity out of order at position ${i}: ` +
        `${prev.severity}(${prev.rule_id}) before ${curr.severity}(${curr.rule_id})`
      );
    }
    // Within same severity bucket, confidence must be non-increasing
    if (currSev === prevSev && curr.confidence > prev.confidence) {
      fail(
        `step2: Confidence out of order within ${curr.severity}: ` +
        `${prev.rule_id}(${prev.confidence}) before ${curr.rule_id}(${curr.confidence})`
      );
    }
  }

  console.log(
    `       Sort order OK: [${findings.slice(0, 5).map((f) => `${f.rule_id}(${f.severity})`).join(", ")}${findings.length > 5 ? "..." : ""}]`
  );

  pass(`step2: findings sorted Cetus-class first, then severity desc, confidence desc`);
  passed++;

  // ── Step 3: Severity counts and risk grade mapping ────────────────────────

  const counts = report.severity_counts;
  const expectedCounts = computeSeverityCounts(findings);

  if (counts.critical !== expectedCounts.critical ||
      counts.high     !== expectedCounts.high     ||
      counts.medium   !== expectedCounts.medium   ||
      counts.low      !== expectedCounts.low) {
    fail(
      `step3: severity_counts mismatch.\n` +
      `  Got: ${JSON.stringify(counts)}\n` +
      `  Expected: ${JSON.stringify(expectedCounts)}`
    );
  }

  const expectedGrade = computeRiskGrade(counts);
  if (report.risk_grade !== expectedGrade) {
    fail(`step3: risk_grade="${report.risk_grade}", expected "${expectedGrade}"`);
  }

  console.log(`       severity_counts: ${JSON.stringify(counts)}`);
  console.log(`       risk_grade: ${report.risk_grade}`);

  // Spot-check the full grade mapping with synthetic count sets
  const gradeTests: Array<[{ critical: number; high: number; medium: number; low: number }, string]> = [
    [{ critical: 1, high: 0, medium: 0, low: 0 }, "F"],
    [{ critical: 0, high: 2, medium: 0, low: 0 }, "D"],
    [{ critical: 0, high: 3, medium: 1, low: 0 }, "D"],
    [{ critical: 0, high: 1, medium: 5, low: 0 }, "C"],
    [{ critical: 0, high: 0, medium: 2, low: 0 }, "B"],
    [{ critical: 0, high: 0, medium: 0, low: 3 }, "A"],
    [{ critical: 0, high: 0, medium: 0, low: 0 }, "A"],
  ];

  for (const [c, expectedG] of gradeTests) {
    const got = computeRiskGrade(c);
    if (got !== expectedG) {
      fail(`step3: computeRiskGrade(${JSON.stringify(c)})="${got}", expected "${expectedG}"`);
    }
  }
  console.log(`       All 7 grade-mapping cases pass ✓`);

  pass(`step3: severity_counts correct; risk_grade="${report.risk_grade}" matches mapping`);
  passed++;

  // ── Step 4: Watermark present verbatim ───────────────────────────────────

  if (report.watermark !== WATERMARK) {
    fail(
      `step4: watermark mismatch.\n` +
      `  Got:      "${report.watermark}"\n` +
      `  Expected: "${WATERMARK}"`
    );
  }

  // Confirm z.literal enforcement — a report with a wrong watermark must fail schema
  const tampered = AuditReportSchema.safeParse({ ...report, watermark: "wrong watermark" });
  if (tampered.success) {
    fail(`step4: AuditReportSchema accepted a tampered watermark — schema enforcement broken`);
  }

  console.log(`       watermark: "${report.watermark}"`);

  pass(`step4: watermark present verbatim and schema rejects any other string`);
  passed++;

  // ── Summary ──────────────────────────────────────────────────────────────

  // Informational: clean.move risk grade (ML-INT-004 medium FP on comments → "B" expected)
  const cleanCtx    = buildCtx("clean", readFixture("clean"));
  const cleanResult = await runAudit(cleanCtx);
  const cleanReport = assembleReport(cleanCtx, cleanResult);
  // clean.move has known medium false positives (ML-INT-004 on "/" in comments),
  // so grade B is expected (no critical/high, some medium). Not a failure.
  const cleanHasCriticalOrHigh = cleanReport.findings.some(
    (f) => f.severity === "critical" || f.severity === "high"
  );
  if (cleanHasCriticalOrHigh) {
    fail(`bonus: clean.move has critical/high findings — expected zero`);
  }
  console.log(`       clean.move risk_grade: ${cleanReport.risk_grade} (no critical/high ✓)`);

  console.log(`\nF11: ${passed}/4 steps passed ✓`);
  console.log(`Report: ${report.report_id} | ${report.risk_grade} | ${report.findings.length} findings`);
}

main().catch((e) => { console.error(e); process.exit(1); });
