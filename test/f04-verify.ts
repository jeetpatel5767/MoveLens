// F04 verification — all 3 steps
import { resolvePackageName } from "../src/lib/mvr/resolve";

async function main() {
  let passed = 0;

  // Step 1: known MVR-registered mainnet package → @scope/name
  // DeepBook: 0x0e735f8c93a95722efd73521aca7a7652c0bb71ed1daf41b26dfd7d1ff71f748 → @deepbook/core
  const deepbook = "0x0e735f8c93a95722efd73521aca7a7652c0bb71ed1daf41b26dfd7d1ff71f748";
  const r1 = await resolvePackageName(deepbook);
  if (r1.name && r1.name.startsWith("@")) {
    console.log("PASS step1: resolved MVR name —", r1.name);
    passed++;
  } else {
    console.error("FAIL step1: expected @scope/name, got:", r1.name);
    process.exit(1);
  }

  // Step 2: unregistered package → { name: null } without throwing
  const unregistered = "0x000000000000000000000000000000000000000000000000000000000000dead";
  const r2 = await resolvePackageName(unregistered);
  if (r2.name === null) {
    console.log("PASS step2: unregistered package returns { name: null }");
    passed++;
  } else {
    console.error("FAIL step2: expected null, got:", r2.name);
    process.exit(1);
  }

  // Step 3: simulate timeout → returns nulls, audit pipeline continues
  // Patch fetch to simulate timeout by using an unreachable host
  const orig = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("simulated timeout"); };
  const r3 = await resolvePackageName(deepbook);
  globalThis.fetch = orig;
  if (r3.name === null && r3.sourceRepo === null) {
    console.log("PASS step3: timeout returns { name: null, sourceRepo: null } — pipeline continues");
    passed++;
  } else {
    console.error("FAIL step3: timeout should return nulls, got:", r3);
    process.exit(1);
  }

  console.log(`\nF04: ${passed}/3 steps passed ✓`);
}

main().catch(e => { console.error(e); process.exit(1); });
