// F13 verification — Quilt bundler
//
// Step 1: Build a quilt from a fixture report
// Step 2: Verify 3 entries with correct identifiers (report.json, findings.enc, summary.md)
// Step 3: Verify report.json contains only public metadata plus watermark — no decrypted findings
// Step 4: Verify findings.enc bytes equal the encryptedBytes input exactly

import * as fs from "fs";
import * as path from "path";
import { buildQuilt, QuiltEntry, QuiltPublicMeta } from "../src/lib/walrus/quilt";
import { runAudit, assembleReport } from "../src/lib/audit/engine";
import { encryptReport } from "../src/lib/seal/encrypt";
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

/** Byte-compare two Uint8Arrays. */
function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

async function main() {
  let passed = 0;

  // ── Prepare fixture report + encrypted bytes ──────────────────────────────────
  const overflowSrc = fs.readFileSync(
    path.join(FIXTURES_DIR, "overflow.move"), "utf-8"
  );
  const ctx          = buildCtx("overflow", overflowSrc);
  const engineResult = await runAudit(ctx);
  const report       = assembleReport(ctx, engineResult);

  // Validate report before testing quilt
  const validated = AuditReportSchema.safeParse(report);
  if (!validated.success) {
    fail(`pre-check: AuditReport schema validation failed: ${JSON.stringify(validated.error.issues)}`);
    return;
  }

  const OWNER_ADDRESS =
    "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";

  const sealResult = await encryptReport(report, OWNER_ADDRESS);
  // buildQuilt accepts both sealed and unsealed bytes — test with whatever we got
  const { encryptedBytes, sealed } = sealResult;
  console.log(`  pre-check: sealResult.sealed=${sealed}, encryptedBytes.length=${encryptedBytes.length}`);

  // ── Step 1: Build a quilt ─────────────────────────────────────────────────────
  let entries: QuiltEntry[];
  try {
    entries = buildQuilt(report, encryptedBytes, sealed);
  } catch (e) {
    fail(`step1: buildQuilt threw: ${e}`);
    return;
  }

  if (!Array.isArray(entries)) {
    fail(`step1: buildQuilt returned non-array: ${typeof entries}`);
    return;
  }
  console.log(`       entries: [${entries.map((e) => `"${e.identifier}"`).join(", ")}]`);
  pass(`step1: buildQuilt returned ${entries.length} entries`);
  passed++;

  // ── Step 2: Exactly 3 entries with correct identifiers ───────────────────────
  const REQUIRED_IDS = ["report.json", "findings.enc", "summary.md"];

  if (entries.length !== 3) {
    fail(`step2: expected 3 entries, got ${entries.length}`);
    return;
  }

  for (const reqId of REQUIRED_IDS) {
    const found = entries.find((e) => e.identifier === reqId);
    if (!found) {
      fail(`step2: missing entry with identifier "${reqId}"`);
      return;
    }
    if (!(found.contents instanceof Uint8Array)) {
      fail(`step2: "${reqId}".contents is not Uint8Array`);
      return;
    }
    if (found.contents.length === 0) {
      fail(`step2: "${reqId}".contents is empty`);
      return;
    }
    console.log(`       "${reqId}": ${found.contents.length} bytes ✓`);
  }

  // Verify order: report.json, findings.enc, summary.md (in that order)
  for (let i = 0; i < REQUIRED_IDS.length; i++) {
    if (entries[i].identifier !== REQUIRED_IDS[i]) {
      fail(
        `step2: entries[${i}].identifier="${entries[i].identifier}", expected "${REQUIRED_IDS[i]}"`
      );
      return;
    }
  }

  pass("step2: 3 entries present in order (report.json, findings.enc, summary.md)");
  passed++;

  // ── Step 3: report.json — public metadata only, NO decrypted findings ─────────
  const reportJsonEntry = entries.find((e) => e.identifier === "report.json")!;
  let publicMeta: QuiltPublicMeta;
  try {
    publicMeta = JSON.parse(new TextDecoder().decode(reportJsonEntry.contents));
  } catch (e) {
    fail(`step3: report.json contents are not valid JSON: ${e}`);
    return;
  }

  // Must have required public fields
  const requiredFields: (keyof QuiltPublicMeta)[] = [
    "package_ref", "generated_at", "risk_grade", "severity_counts", "sealed", "watermark",
  ];
  for (const field of requiredFields) {
    if (!(field in publicMeta)) {
      fail(`step3: report.json missing required field "${field}"`);
      return;
    }
  }

  // Watermark must be verbatim
  if (publicMeta.watermark !== WATERMARK) {
    fail(
      `step3: report.json watermark mismatch.\n` +
      `  Got:      "${publicMeta.watermark}"\n` +
      `  Expected: "${WATERMARK}"`
    );
    return;
  }

  // MUST NOT contain findings array (the decrypted findings)
  const metaAny = publicMeta as unknown as Record<string, unknown>;
  if ("findings" in metaAny && Array.isArray(metaAny["findings"])) {
    fail(
      `step3: report.json contains a "findings" array — decrypted findings must NOT be in public metadata`
    );
    return;
  }

  // MUST NOT contain any finding-level fields (rule_id, confidence, etc.)
  const FINDING_FIELDS = ["rule_id", "confidence", "source", "description", "recommendation"];
  for (const ff of FINDING_FIELDS) {
    if (ff in metaAny) {
      fail(`step3: report.json contains finding field "${ff}" — should not be in public metadata`);
      return;
    }
  }

  // severity_counts must match the report
  const sc = publicMeta.severity_counts;
  if (
    sc.critical !== report.severity_counts.critical ||
    sc.high     !== report.severity_counts.high     ||
    sc.medium   !== report.severity_counts.medium   ||
    sc.low      !== report.severity_counts.low
  ) {
    fail(
      `step3: severity_counts mismatch.\n` +
      `  report.json: ${JSON.stringify(sc)}\n` +
      `  report:      ${JSON.stringify(report.severity_counts)}`
    );
    return;
  }

  // risk_grade must match
  if (publicMeta.risk_grade !== report.risk_grade) {
    fail(`step3: risk_grade mismatch: "${publicMeta.risk_grade}" ≠ "${report.risk_grade}"`);
    return;
  }

  // sealed flag must match
  if (publicMeta.sealed !== sealed) {
    fail(`step3: sealed flag mismatch: ${publicMeta.sealed} ≠ ${sealed}`);
    return;
  }

  console.log(
    `       report.json: package_ref="${publicMeta.package_ref}", ` +
    `risk_grade="${publicMeta.risk_grade}", sealed=${publicMeta.sealed}, ` +
    `watermark present ✓, no findings ✓`
  );
  pass("step3: report.json has public metadata + watermark, no decrypted findings");
  passed++;

  // ── Step 4: findings.enc bytes equal encryptedBytes exactly ──────────────────
  const findingsEncEntry = entries.find((e) => e.identifier === "findings.enc")!;

  if (!bytesEqual(findingsEncEntry.contents, encryptedBytes)) {
    fail(
      `step4: findings.enc bytes do not match encryptedBytes.\n` +
      `  findings.enc length: ${findingsEncEntry.contents.length}\n` +
      `  encryptedBytes length: ${encryptedBytes.length}`
    );
    return;
  }

  console.log(`       findings.enc: ${findingsEncEntry.contents.length} bytes, byte-identical ✓`);

  // Also verify summary.md contains the watermark and risk grade
  const summaryEntry = entries.find((e) => e.identifier === "summary.md")!;
  const summaryText  = new TextDecoder().decode(summaryEntry.contents);

  if (!summaryText.includes(WATERMARK)) {
    fail(`step4: summary.md does not contain the watermark`);
    return;
  }
  if (!summaryText.includes(report.risk_grade)) {
    fail(`step4: summary.md does not contain risk_grade "${report.risk_grade}"`);
    return;
  }

  console.log(
    `       summary.md: ${summaryEntry.contents.length} bytes, ` +
    `watermark present ✓, risk_grade "${report.risk_grade}" present ✓`
  );

  pass("step4: findings.enc bytes are byte-identical to encryptedBytes; summary.md is valid");
  passed++;

  // ── Summary ───────────────────────────────────────────────────────────────────
  console.log(`\nF13: ${passed}/4 steps passed ✓`);
  console.log(
    `  report.json: ${entries[0].contents.length}B  ` +
    `findings.enc: ${entries[1].contents.length}B  ` +
    `summary.md: ${entries[2].contents.length}B`
  );
}

main().catch((e) => { console.error(e); process.exit(1); });
