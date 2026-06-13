// F23 verification — Demo assets: demo.md + README
//
// Step 1: Verify scripts/demo.md exists with the 3-minute flow + judging criteria
// Step 2: Verify demo.md contains a real backup blobId and tx digest from a pre-run audit
// Step 3: Verify README.md covers pitch, architecture, stack, setup

import { readFileSync, existsSync } from "fs";
import { join } from "path";

const ROOT = process.cwd();

function pass(msg: string) { console.log("PASS", msg); }
function fail(msg: string) { console.error("FAIL", msg); process.exit(1); }

function main() {
  let passed = 0;

  // ── Step 1: scripts/demo.md structure ─────────────────────────────────────
  console.log("\n  [step1] Verify scripts/demo.md exists with 3-min flow and judging criteria…");

  const demoPath = join(ROOT, "scripts", "demo.md");
  if (!existsSync(demoPath)) {
    fail("step1: scripts/demo.md is missing");
    return;
  }

  const demo = readFileSync(demoPath, "utf8");

  const demoChecks: { name: string; re: RegExp }[] = [
    { name: "3-minute flow heading",     re: /3.Minute Demo|3-Minute/i },
    { name: "demo steps/sections",        re: /0:00|0:20|0:50|1:50|2:20|2:50/i },
    { name: "Real-World judging hit",    re: /Real.World/i },
    { name: "Technical judging hit",     re: /Technical/i },
    { name: "UX judging hit",            re: /UX|Product/i },
    { name: "Vision judging hit",        re: /Vision/i },
    { name: "Layer 1 mention",           re: /Layer 1/i },
    { name: "Walrus mention",            re: /Walrus/i },
    { name: "Seal mention",              re: /Seal/i },
    { name: "judging criteria table",    re: /Criterion|Weight|What to show/i },
  ];

  const demoProblem = demoChecks.find((c) => !c.re.test(demo));
  if (demoProblem) {
    fail(`step1: demo.md missing: ${demoProblem.name}`);
    return;
  }

  pass(`step1: scripts/demo.md has ${demoChecks.length}/${demoChecks.length} required sections`);
  passed++;

  // ── Step 2: Real backup blobId + tx digest ─────────────────────────────────
  console.log("\n  [step2] Verify demo.md contains a real backup blobId and tx digest…");

  // Walrus blob IDs are base64url strings, typically 43 chars ending with =, - or alphanumeric
  const blobIdMatch = demo.match(/`([A-Za-z0-9_-]{40,})`/g);
  const hasBlobId = blobIdMatch && blobIdMatch.some((m) => m.length >= 42);

  // Sui TX digests are base58, ~43-44 chars (alphanumeric, no +/=)
  const txMatch = demo.match(/[1-9A-HJ-NP-Za-km-z]{40,}/g);
  const hasTxDigest = txMatch && txMatch.some((m) => m.length >= 40 && m.length <= 50);

  console.log(`       blobId found: ${hasBlobId} (${blobIdMatch?.[0]?.slice(1,20)}…)`);
  console.log(`       tx digest found: ${hasTxDigest}`);

  if (!hasBlobId) {
    fail("step2: demo.md has no backup blobId (expected a backtick-wrapped base64url string)");
    return;
  }
  if (!hasTxDigest) {
    fail("step2: demo.md has no tx digest (expected a base58 string)");
    return;
  }

  pass("step2: demo.md has real backup blobId and tx digest");
  passed++;

  // ── Step 3: README.md completeness ─────────────────────────────────────────
  console.log("\n  [step3] Verify README.md covers pitch, architecture, stack, setup…");

  const readmePath = join(ROOT, "README.md");
  if (!existsSync(readmePath)) {
    fail("step3: README.md is missing");
    return;
  }

  const readme = readFileSync(readmePath, "utf8");

  const readmeChecks: { name: string; re: RegExp }[] = [
    { name: "pitch paragraph",           re: /zero.cost|security|Sui Move/i },
    { name: "architecture section",      re: /Architecture|architecture/i },
    { name: "4-layer engine",            re: /Layer 1|Layer 2|4-layer/i },
    { name: "Walrus in stack",           re: /Walrus/i },
    { name: "Seal in stack",             re: /Seal/i },
    { name: "MVR in stack",              re: /MVR/i },
    { name: "npm install step",          re: /npm install/i },
    { name: "SUI_KEYPAIR_B64 key",      re: /SUI_KEYPAIR_B64/ },
    { name: "init.sh usage",             re: /init\.sh/ },
    { name: "watermark present",         re: /not a substitute for a human audit/i },
  ];

  const readmeProblem = readmeChecks.find((c) => !c.re.test(readme));
  if (readmeProblem) {
    fail(`step3: README.md missing: ${readmeProblem.name}`);
    return;
  }

  pass(`step3: README.md has ${readmeChecks.length}/${readmeChecks.length} required sections`);
  passed++;

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log(`\nF23: ${passed}/3 steps passed ✓`);
}

main();
