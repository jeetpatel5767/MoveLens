// F05 verification — all 3 steps
import { buildPackageContextFromUpload, UploadValidationError } from "../src/lib/ingest/upload";

function pass(msg: string) { console.log("PASS", msg); }
function fail(msg: string) { console.error("FAIL", msg); process.exit(1); }

async function main() {
  let passed = 0;

  // Step 1: non-.move file → 400 UploadValidationError
  try {
    buildPackageContextFromUpload([{ name: "evil.js", content: "console.log('hi')" }]);
    fail("step1a: non-.move file should be rejected");
  } catch (e: any) {
    if (e instanceof UploadValidationError && e.statusCode === 400 && e.message.includes("evil.js")) {
      pass(`step1a: non-.move file rejected — ${e.message}`);
    } else fail(`step1a: wrong error: ${e.name} ${e.message}`);
  }

  // >1 MB payload → 400
  const bigContent = "x".repeat(1.1 * 1024 * 1024);
  try {
    buildPackageContextFromUpload([{ name: "big.move", content: bigContent }]);
    fail("step1b: >1MB should be rejected");
  } catch (e: any) {
    if (e instanceof UploadValidationError && e.message.includes("exceeds 1 MB")) {
      pass(`step1b: >1 MB payload rejected — ${e.message}`);
    } else fail(`step1b: wrong error: ${e.message}`);
  }
  passed++;

  // Step 2: no module declaration → 400
  try {
    buildPackageContextFromUpload([{ name: "empty.move", content: "// just a comment" }]);
    fail("step2: missing module declaration should be rejected");
  } catch (e: any) {
    if (e instanceof UploadValidationError && e.message.includes("module")) {
      pass(`step2: no module declaration rejected — ${e.message}`);
      passed++;
    } else fail(`step2: wrong error: ${e.message}`);
  }

  // Step 3: valid upload → PackageContext with modules populated
  const validFiles = [
    { name: "counter.move", content: "module counter::counter { public fun increment() {} }" },
    { name: "utils.move",   content: "module counter::utils { public fun helper() {} }" },
  ];
  const ctx = buildPackageContextFromUpload(validFiles);
  if (
    ctx.packageId === "local-upload" &&
    ctx.modules.length === 2 &&
    ctx.modules[0].source !== null &&
    ctx.modules[0].name === "counter" &&
    ctx.modules[1].name === "utils"
  ) {
    pass(`step3: valid upload → PackageContext with ${ctx.modules.length} modules, packageId="${ctx.packageId}"`);
    passed++;
  } else {
    fail(`step3: unexpected context: ${JSON.stringify(ctx)}`);
  }

  console.log(`\nF05: ${passed}/3 steps passed ✓`);
}

main().catch(e => { console.error(e); process.exit(1); });
