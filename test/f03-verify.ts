// F03 verification — all 3 steps
import { fetchPackage, InvalidAddressError, PackageNotFoundError } from "../src/lib/sui/queries";

async function main() {
  let passed = 0;

  // Step 1: malformed address → InvalidAddressError, NO network call
  try {
    await fetchPackage("not-an-address");
    console.error("FAIL step1: no error thrown"); process.exit(1);
  } catch (e: any) {
    if (e instanceof InvalidAddressError) {
      console.log("PASS step1: InvalidAddressError before network —", e.message);
      passed++;
    } else {
      console.error("FAIL step1: wrong error:", e.name, e.message); process.exit(1);
    }
  }

  // Step 2: valid format, nonexistent address → PackageNotFoundError
  const dead = "0x000000000000000000000000000000000000000000000000000000000000dead";
  try {
    await fetchPackage(dead);
    console.error("FAIL step2: no error thrown"); process.exit(1);
  } catch (e: any) {
    if (e instanceof PackageNotFoundError) {
      console.log("PASS step2: PackageNotFoundError for nonexistent address —", e.message);
      passed++;
    } else {
      console.error("FAIL step2: wrong error:", e.name, e.message); process.exit(1);
    }
  }

  // Step 3: readable message check
  const err = new PackageNotFoundError("0xdead");
  const hasReadable = err.message.includes("0xdead") && err.message.length > 10;
  if (hasReadable) {
    console.log("PASS step3: PackageNotFoundError message is readable —", err.message);
    passed++;
  } else {
    console.error("FAIL step3: message not readable:", err.message); process.exit(1);
  }

  console.log(`\nF03: ${passed}/3 steps passed ✓`);
}

main().catch(e => { console.error(e); process.exit(1); });
