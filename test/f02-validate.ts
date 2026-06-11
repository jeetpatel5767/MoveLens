import { fetchPackage, InvalidAddressError } from "../src/lib/sui/queries";
import { execSync } from "child_process";

async function main() {
let passed = 0;

// Test 1: malformed address → InvalidAddressError before any network call
try {
  await fetchPackage("not-an-address");
  console.error("FAIL test1: no error thrown");
  process.exit(1);
} catch (e: any) {
  if (e.name === "InvalidAddressError") {
    console.log("PASS test1: InvalidAddressError for malformed address —", e.message);
    passed++;
  } else {
    console.error("FAIL test1: wrong error type:", e.name, e.message);
    process.exit(1);
  }
}

// Test 2: valid format no 0x → InvalidAddressError
try {
  await fetchPackage("deadbeef1234");
  console.error("FAIL test2: no error thrown");
  process.exit(1);
} catch (e: any) {
  if (e.name === "InvalidAddressError") {
    console.log("PASS test2: InvalidAddressError for missing 0x —", e.message);
    passed++;
  } else {
    console.error("FAIL test2:", e.name, e.message);
    process.exit(1);
  }
}

// Test 3: grep check — no jsonrpc in src/
try {
  const out = execSync("grep -ri jsonrpc src/", { encoding: "utf8" });
  if (out.trim()) {
    console.error("FAIL test3: jsonrpc found in src/:", out);
    process.exit(1);
  }
} catch {
  // grep exits 1 when no matches — that's what we want
  console.log("PASS test3: zero jsonrpc references in src/");
  passed++;
}

console.log(`\nF02 local checks: ${passed}/3 passed`);
}

main().catch(e => { console.error(e); process.exit(1); });
