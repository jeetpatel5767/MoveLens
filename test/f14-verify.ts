// F14 verification — Walrus blob upload
//
// Step 1: Run a fixture audit end-to-end and upload to Walrus testnet
// Step 2: Verify a real blobId is returned (non-empty string)
// Step 3: Fetch the blob back by id, verify report.json entry matches original
// Step 4: Re-fetch (fresh client) to confirm the blob is persistently retrievable
//
// SKIP behavior:
//   If SUI_KEYPAIR_B64 is the placeholder value, all upload steps are skipped
//   and F14 stays passes:false. The skip message tells the operator how to fix it.
//
// NOTE: F14 only marks passes:true when a REAL Walrus upload completes.
//       Record the returned blobId in progress.txt as an artifact.

import * as fs from "fs";
import * as path from "path";
import { buildQuilt } from "../src/lib/walrus/quilt";
import {
  uploadAuditQuilt,
  fetchAuditBlob,
  WalrusUploadError,
} from "../src/lib/walrus/upload";
import { encryptReport } from "../src/lib/seal/encrypt";
import { runAudit, assembleReport } from "../src/lib/audit/engine";
import { AuditReportSchema, WATERMARK } from "../src/lib/audit/schema";
import type { PackageContext } from "../src/lib/sui/queries";

function pass(msg: string) { console.log("PASS", msg); }
function fail(msg: string) { console.error("FAIL", msg); process.exit(1); }
function skip(msg: string) { console.log("SKIP", msg); }

const FIXTURES_DIR = path.join(__dirname, "fixtures");
const OWNER_ADDRESS =
  "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";

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

  // ── Prepare fixture audit ────────────────────────────────────────────────────
  const overflowSrc = fs.readFileSync(
    path.join(FIXTURES_DIR, "overflow.move"), "utf-8"
  );
  const ctx          = buildCtx("overflow", overflowSrc);
  const engineResult = await runAudit(ctx);
  const report       = assembleReport(ctx, engineResult);

  const validated = AuditReportSchema.safeParse(report);
  if (!validated.success) {
    fail(`pre-check: AuditReport schema validation failed: ${JSON.stringify(validated.error.issues)}`);
    return;
  }

  const sealResult = await encryptReport(report, OWNER_ADDRESS);
  const { encryptedBytes, sealed } = sealResult;
  console.log(`  pre-check: sealResult.sealed=${sealed}, encryptedBytes.length=${encryptedBytes.length}`);

  const entries = buildQuilt(report, encryptedBytes, sealed);
  console.log(`  pre-check: quilt entries: [${entries.map(e => `"${e.identifier}"`).join(", ")}]`);

  // ── Step 1: Upload to Walrus testnet ─────────────────────────────────────────
  console.log("  [step1] Uploading audit quilt to Walrus testnet…");
  console.log("          (this may take 30–120 seconds on first upload)");

  let uploadResult: { blobId: string; quiltPatchIds: Record<string, string> };
  try {
    uploadResult = await uploadAuditQuilt(entries);
  } catch (e) {
    if (e instanceof WalrusUploadError && e.message.includes("placeholder")) {
      skip(
        "step1: SUI_KEYPAIR_B64 is the placeholder value. " +
        "Set a real funded testnet keypair to complete F14. " +
        "Export with: sui keytool export --key-identity <alias> --json\n" +
        "         Then base64-encode the suiprivkey string and set SUI_KEYPAIR_B64."
      );
      console.log("\nF14: 0/4 steps passed (keypair placeholder — upload skipped)");
      console.log("  F14 stays passes:false until a real keypair is configured.");
      process.exit(0);
    }
    fail(`step1: uploadAuditQuilt threw: ${e}`);
    return;
  }

  console.log(`       blobId: ${uploadResult.blobId}`);
  console.log(`       patches: ${JSON.stringify(Object.keys(uploadResult.quiltPatchIds))}`);

  if (typeof uploadResult.blobId !== "string" || uploadResult.blobId.length === 0) {
    fail("step1: blobId is empty or not a string");
    return;
  }

  pass(`step1: quilt uploaded to Walrus testnet. blobId=${uploadResult.blobId}`);
  passed++;

  // ── Step 2: Verify blobId is non-empty (real Walrus blob) ────────────────────
  // The blobId is a base64url-encoded 32-byte Sui object id.
  // A real blobId is 43-44 characters in URL-safe base64 (256 bits).
  const blobIdLen = uploadResult.blobId.length;
  if (blobIdLen < 10) {
    fail(`step2: blobId looks too short to be real: "${uploadResult.blobId}"`);
    return;
  }

  // Verify all three patch ids are present
  const EXPECTED_IDS = ["report.json", "findings.enc", "summary.md"];
  for (const id of EXPECTED_IDS) {
    if (!(id in uploadResult.quiltPatchIds)) {
      fail(`step2: quiltPatchIds is missing "${id}"`);
      return;
    }
  }

  console.log(`       blobId length: ${blobIdLen} chars ✓`);
  console.log(`       quiltPatchIds keys: ${Object.keys(uploadResult.quiltPatchIds).join(", ")} ✓`);
  pass(`step2: blobId="${uploadResult.blobId}" (${blobIdLen} chars), 3 patch ids present`);
  passed++;

  // ── Step 3: Fetch back and verify report.json ────────────────────────────────
  console.log(`  [step3] Fetching blob back from Walrus… blobId=${uploadResult.blobId}`);

  let fetched: Map<string, Uint8Array>;
  try {
    fetched = await fetchAuditBlob(uploadResult.blobId, uploadResult.quiltPatchIds);
  } catch (e) {
    fail(`step3: fetchAuditBlob threw: ${e}`);
    return;
  }

  if (fetched.size === 0) {
    fail("step3: fetchAuditBlob returned empty map");
    return;
  }

  // Verify report.json parses and contains expected fields
  const reportJsonBytes = fetched.get("report.json");
  if (!reportJsonBytes) {
    fail("step3: report.json missing from fetched entries");
    return;
  }

  let fetchedMeta: Record<string, unknown>;
  try {
    fetchedMeta = JSON.parse(new TextDecoder().decode(reportJsonBytes));
  } catch (e) {
    fail(`step3: report.json is not valid JSON after fetch: ${e}`);
    return;
  }

  // Verify key fields
  if (fetchedMeta["report_id"] !== report.report_id) {
    fail(
      `step3: report_id mismatch after fetch.\n` +
      `  fetched: "${fetchedMeta["report_id"]}"\n` +
      `  expected: "${report.report_id}"`
    );
    return;
  }
  if (fetchedMeta["risk_grade"] !== report.risk_grade) {
    fail(`step3: risk_grade mismatch: "${fetchedMeta["risk_grade"]}" ≠ "${report.risk_grade}"`);
    return;
  }
  if (fetchedMeta["watermark"] !== WATERMARK) {
    fail(`step3: watermark missing or wrong in fetched report.json`);
    return;
  }

  // Verify findings.enc is present (byte-non-empty)
  const findingsEnc = fetched.get("findings.enc");
  if (!findingsEnc || findingsEnc.length === 0) {
    fail("step3: findings.enc missing or empty");
    return;
  }

  // Verify summary.md is present
  const summaryMd = fetched.get("summary.md");
  if (!summaryMd || summaryMd.length === 0) {
    fail("step3: summary.md missing or empty");
    return;
  }

  console.log(
    `       report.json: report_id="${fetchedMeta["report_id"]}", ` +
    `risk_grade="${fetchedMeta["risk_grade"]}", watermark ✓`
  );
  console.log(
    `       findings.enc: ${findingsEnc.length}B  ` +
    `summary.md: ${summaryMd.length}B`
  );
  pass("step3: fetched report.json matches original (report_id, risk_grade, watermark)");
  passed++;

  // ── Step 4: Re-fetch to confirm persistent retrievability ────────────────────
  //
  // We re-fetch using a fresh WalrusClient instance (createWalrusClient is called
  // inside fetchAuditBlob on every invocation — no caching between calls).
  console.log(`  [step4] Re-fetching blob to verify persistent storage…`);

  let refetched: Map<string, Uint8Array>;
  try {
    refetched = await fetchAuditBlob(uploadResult.blobId, uploadResult.quiltPatchIds);
  } catch (e) {
    fail(`step4: second fetchAuditBlob threw: ${e}`);
    return;
  }

  const refetchedReportJson = refetched.get("report.json");
  if (!refetchedReportJson) {
    fail("step4: report.json missing from re-fetch");
    return;
  }

  // Byte-compare report.json between first and second fetch
  const firstBytes  = reportJsonBytes;
  const secondBytes = refetchedReportJson;

  if (firstBytes.length !== secondBytes.length) {
    fail(
      `step4: report.json byte length differs between fetches: ` +
      `${firstBytes.length} vs ${secondBytes.length}`
    );
    return;
  }
  for (let i = 0; i < firstBytes.length; i++) {
    if (firstBytes[i] !== secondBytes[i]) {
      fail(`step4: report.json byte mismatch at offset ${i}`);
      return;
    }
  }

  console.log(`       re-fetch: report.json byte-identical to first fetch ✓`);
  pass("step4: blob is persistently retrievable (re-fetch byte-identical)");
  passed++;

  // ── Summary ──────────────────────────────────────────────────────────────────
  console.log(`\nF14: ${passed}/4 steps passed ✓  (REAL Walrus upload)`);
  console.log(`  blobId: ${uploadResult.blobId}`);
  console.log(`  RECORD THIS blobId IN progress.txt as an artifact.`);
  console.log(`  quiltPatchIds: ${JSON.stringify(uploadResult.quiltPatchIds, null, 2)}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
