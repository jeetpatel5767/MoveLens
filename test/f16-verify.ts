// F16 verification — set_metadata attaches Walrus blob ID on-chain
//
// Step 1: Call attachAuditToPackage(DEMO_PACKAGE_INFO_ID, blobId) → tx digest returned.
// Step 2: Verify the tx digest is non-empty.
// Step 3: Call readAuditMetadata(DEMO_PACKAGE_INFO_ID) → same blobId returned via GraphQL.
//
// Uses the F14 Walrus blob ID as the test value.
// NOTE: F16 steps require a real on-chain TX (costs a tiny amount of gas).

import {
  DEMO_PACKAGE_INFO_ID,
  attachAuditToPackage,
  readAuditMetadata,
} from "../src/lib/mvr/metadata";

function pass(msg: string) { console.log("PASS", msg); }
function fail(msg: string) { console.error("FAIL", msg); process.exit(1); }

// The Walrus blob ID from Session 13 (F14). Used as the test blob ID.
const TEST_BLOB_ID = "pzQ9tB1U4u0RoRGs2hrkvPk9lExWUvkWL5A2isw_3zA";

async function main() {
  let passed = 0;

  console.log(`  Using PackageInfo: ${DEMO_PACKAGE_INFO_ID}`);
  console.log(`  Test blob ID: ${TEST_BLOB_ID}`);

  // ── Step 1: attachAuditToPackage ─────────────────────────────────────────
  console.log(`\n  [step1] Calling attachAuditToPackage...`);
  console.log(`          (sets "movelens_audit" = "${TEST_BLOB_ID}" on-chain)`);

  let txDigest: string;
  try {
    txDigest = await attachAuditToPackage(DEMO_PACKAGE_INFO_ID, TEST_BLOB_ID);
  } catch (e) {
    fail(`step1: attachAuditToPackage threw: ${e}`);
    return;
  }

  if (typeof txDigest !== "string" || txDigest.length === 0) {
    fail(`step1: txDigest is empty or not a string`);
    return;
  }

  console.log(`       txDigest: ${txDigest}`);
  pass(`step1: attachAuditToPackage succeeded. txDigest=${txDigest}`);
  passed++;

  // ── Step 2: Verify tx digest is a real string ────────────────────────────
  // A Sui tx digest is a base58-encoded 32-byte hash (~44 chars)
  if (txDigest.length < 20) {
    fail(`step2: txDigest looks too short: "${txDigest}"`);
    return;
  }

  console.log(`       txDigest length: ${txDigest.length} chars ✓`);
  pass(`step2: txDigest="${txDigest}" (${txDigest.length} chars) is valid`);
  passed++;

  // ── Step 3: readAuditMetadata verifies the blob ID is stored ────────────
  console.log(`\n  [step3] Calling readAuditMetadata to verify on-chain state…`);

  let fetchedBlobId: string | null;
  try {
    fetchedBlobId = await readAuditMetadata(DEMO_PACKAGE_INFO_ID);
  } catch (e) {
    fail(`step3: readAuditMetadata threw: ${e}`);
    return;
  }

  if (fetchedBlobId === null) {
    fail(
      `step3: readAuditMetadata returned null — "movelens_audit" key not found in PackageInfo`,
    );
    return;
  }

  if (fetchedBlobId !== TEST_BLOB_ID) {
    fail(
      `step3: blob ID mismatch:\n` +
      `  fetched:  "${fetchedBlobId}"\n` +
      `  expected: "${TEST_BLOB_ID}"`,
    );
    return;
  }

  console.log(`       fetched blobId: "${fetchedBlobId}" ✓`);
  pass(`step3: readAuditMetadata returned correct blobId "${fetchedBlobId}"`);
  passed++;

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log(`\nF16: ${passed}/3 steps passed ✓`);
  console.log(`  packageInfoId: ${DEMO_PACKAGE_INFO_ID}`);
  console.log(`  blobId attached: ${TEST_BLOB_ID}`);
  console.log(`  txDigest: ${txDigest}`);
  console.log(`  RECORD txDigest in progress.txt`);
}

main().catch((e) => { console.error(e); process.exit(1); });
