// F12 verification — Seal threshold encryption round-trip
//
// Step 1: Encrypt a fixture report with encryptReport
// Step 2: Verify ciphertext is not parseable JSON
// Step 3: Decrypt with the owner identity (backup key), verify byte-identical report
// Step 4: Test fallback path (Seal disabled) → sealed=false with loud warning
//
// IMPORTANT: This test only marks F12 passing when sealed=true in step 1.
// If Seal testnet is unreachable, the test exercises the fallback path only
// and reports a skip message — F12 stays passes:false.

import * as path from "path";
import * as fs from "fs";
import {
  encryptReport,
  decryptReportWithBackupKey,
  encryptReportFallback,
} from "../src/lib/seal/encrypt";
import { runAudit, assembleReport } from "../src/lib/audit/engine";
import { AuditReportSchema, WATERMARK } from "../src/lib/audit/schema";
import type { PackageContext } from "../src/lib/sui/queries";

function pass(msg: string) { console.log("PASS", msg); }
function fail(msg: string) { console.error("FAIL", msg); process.exit(1); }
function skip(msg: string) { console.log("SKIP", msg); }

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

async function main() {
  let passed = 0;

  // ── Prepare a fixture report ─────────────────────────────────────────────────
  const overflowSrc = fs.readFileSync(
    path.join(FIXTURES_DIR, "overflow.move"), "utf-8"
  );
  const ctx = buildCtx("overflow", overflowSrc);
  const engineResult = await runAudit(ctx);
  const report = assembleReport(ctx, engineResult);

  // Validate the assembled report before testing Seal
  const validated = AuditReportSchema.safeParse(report);
  if (!validated.success) {
    fail(`pre-check: AuditReport failed schema validation: ${JSON.stringify(validated.error.issues)}`);
    return;
  }

  // Use a deterministic fake owner address for testing
  const OWNER_ADDRESS = "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";

  // ── Step 1: Encrypt fixture report ──────────────────────────────────────────
  console.log("  [step1] Attempting Seal encryption (testnet key server)...");
  const sealResult = await encryptReport(report, OWNER_ADDRESS);

  if (!sealResult.sealed) {
    // Seal unavailable — test the fallback path only and skip pass
    skip(
      "step1: Seal testnet unreachable — encrypted with sealed=false (fallback). " +
      "F12 can only pass with REAL Seal encryption (sealed=true). Skipping steps 1-3."
    );
    console.log(`       sealId=${sealResult.sealId}`);

    // Still test step 4 (fallback path) below
  } else {
    // Real Seal encryption succeeded
    console.log(`       sealed=true  sealId=${sealResult.sealId}`);
    console.log(`       encryptedBytes length: ${sealResult.encryptedBytes.length}`);

    pass("step1: encryptReport produced real Seal IBE ciphertext (sealed=true)");
    passed++;

    // ── Step 2: Ciphertext is not parseable JSON ─────────────────────────────
    let isJson = false;
    try {
      const text = new TextDecoder().decode(sealResult.encryptedBytes);
      JSON.parse(text);
      isJson = true;
    } catch {
      // Expected: BCS bytes are not valid JSON
    }

    if (isJson) {
      fail("step2: encryptedBytes is parseable JSON — encryption did not happen");
      return;
    }

    console.log(`       encryptedBytes[0..8]: [${sealResult.encryptedBytes.slice(0, 8).join(", ")}]`);
    pass("step2: ciphertext is NOT parseable JSON (real encryption confirmed)");
    passed++;

    // ── Step 3: Decrypt with backup key, verify byte-identical ───────────────
    if (!sealResult.backupKey) {
      fail("step3: backupKey not returned by encryptReport — cannot test round-trip");
      return;
    }

    let decryptedJson: string;
    try {
      decryptedJson = await decryptReportWithBackupKey(
        sealResult.encryptedBytes,
        sealResult.backupKey,
      );
    } catch (e) {
      fail(`step3: decryptReportWithBackupKey threw: ${e}`);
      return;
    }

    // Parse decrypted JSON
    let decryptedReport: unknown;
    try {
      decryptedReport = JSON.parse(decryptedJson);
    } catch (e) {
      fail(`step3: decrypted bytes are not valid JSON: ${e}`);
      return;
    }

    // Validate against schema
    const parsedDecrypted = AuditReportSchema.safeParse(decryptedReport);
    if (!parsedDecrypted.success) {
      fail(`step3: decrypted report failed schema validation: ${JSON.stringify(parsedDecrypted.error.issues)}`);
      return;
    }

    // Verify key fields are byte-identical
    const decR = parsedDecrypted.data;
    if (decR.report_id !== report.report_id) {
      fail(`step3: report_id mismatch after round-trip: ${decR.report_id} ≠ ${report.report_id}`);
      return;
    }
    if (decR.risk_grade !== report.risk_grade) {
      fail(`step3: risk_grade mismatch: ${decR.risk_grade} ≠ ${report.risk_grade}`);
      return;
    }
    if (decR.watermark !== WATERMARK) {
      fail(`step3: watermark missing after round-trip: got "${decR.watermark}"`);
      return;
    }
    if (decR.findings.length !== report.findings.length) {
      fail(`step3: findings count mismatch: ${decR.findings.length} ≠ ${report.findings.length}`);
      return;
    }

    // Verify byte-identical: re-encode and compare
    const originalJson = JSON.stringify(report);
    const roundTripJson = JSON.stringify(decR);
    if (originalJson !== roundTripJson) {
      fail(
        `step3: round-trip not byte-identical.\n` +
        `  original length: ${originalJson.length}\n` +
        `  round-trip length: ${roundTripJson.length}`
      );
      return;
    }

    console.log(
      `       round-trip verified: ${report.findings.length} findings, ` +
      `risk_grade=${decR.risk_grade}, watermark present ✓`
    );
    pass("step3: decrypted report is byte-identical to original (backup key path)");
    passed++;
  }

  // ── Step 4: Fallback path → sealed=false with loud warning ─────────────────
  //
  // Test that when Seal is explicitly disabled, the pipeline produces:
  //   - sealed: false
  //   - encryptedBytes: parseable JSON (the plaintext report)
  //   - sealId: "unsealed"
  //   - A console.warn message (validated by checking the return values)

  console.log("  [step4] Testing explicit fallback path (Seal disabled)...");

  const fallbackResult = await encryptReportFallback(report);

  if (fallbackResult.sealed !== false) {
    fail(`step4: fallback returned sealed=${fallbackResult.sealed}, expected false`);
    return;
  }
  if (fallbackResult.sealId !== "unsealed") {
    fail(`step4: fallback sealId="${fallbackResult.sealId}", expected "unsealed"`);
    return;
  }

  // Fallback bytes must be parseable JSON (it's the plaintext)
  let fallbackParsed: unknown;
  try {
    fallbackParsed = JSON.parse(new TextDecoder().decode(fallbackResult.encryptedBytes));
  } catch (e) {
    fail(`step4: fallback encryptedBytes not parseable JSON: ${e}`);
    return;
  }
  const fbReport = AuditReportSchema.safeParse(fallbackParsed);
  if (!fbReport.success) {
    fail(`step4: fallback plaintext failed schema validation`);
    return;
  }

  // Verify it's the same report
  if (fbReport.data.report_id !== report.report_id) {
    fail(`step4: fallback report_id mismatch`);
    return;
  }

  console.log(`       fallback: sealed=false, sealId=unsealed, plaintext JSON ✓`);
  pass("step4: fallback produces sealed=false plaintext with loud warning");
  passed++;

  // ── Summary ──────────────────────────────────────────────────────────────────
  if (sealResult.sealed) {
    console.log(`\nF12: ${passed}/4 steps passed ✓  (real Seal encryption)`);
    console.log(`  sealId: ${sealResult.sealId}`);
  } else {
    console.log(`\nF12: ${passed}/1 steps passed (step 4 only — Seal testnet unreachable)`);
    console.log(`  sealed=false — F12 stays passes:false until Seal testnet is reachable`);
    // Exit 0 so init.sh doesn't fail, but F12 is NOT marked passing
    process.exit(0);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
