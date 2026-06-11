// F01 verification: env loader fails fast with readable error on missing var
// Run with: npx tsx test/env-verify.ts

import { execSync } from "child_process";
import { writeFileSync, readFileSync } from "fs";

const ENV_PATH = ".env";
const original = readFileSync(ENV_PATH, "utf8");

console.log("--- Test 1: Missing SUI_KEYPAIR_B64 should fail with readable error ---");
const withoutKey = original.replace(/^SUI_KEYPAIR_B64=.*$/m, "# SUI_KEYPAIR_B64=<removed>");
writeFileSync(ENV_PATH, withoutKey);

let exitCode = 0;
let output = "";
try {
  output = execSync(
    "node --import tsx/esm -e \"import './src/lib/env.ts'\" 2>&1",
    { env: { ...process.env, ...parseEnvFile(withoutKey) }, encoding: "utf8" }
  );
} catch (e: any) {
  output = e.stderr || e.stdout || String(e);
  exitCode = e.status ?? 1;
}

if (exitCode !== 0 && output.includes("SUI_KEYPAIR_B64")) {
  console.log("PASS: exited non-zero and named the missing var SUI_KEYPAIR_B64");
  console.log("  output:", output.trim().split("\n")[0]);
} else {
  console.error("FAIL: did not exit non-zero or did not name the missing var");
  console.error("  exit:", exitCode, "output:", output);
  process.exit(1);
}

console.log("\n--- Test 2: Full .env should load cleanly ---");
writeFileSync(ENV_PATH, original);
try {
  execSync(
    "node --input-type=module --eval \"import './src/lib/env.ts'; console.log('env loaded ok')\" 2>&1",
    { env: { ...process.env, ...parseEnvFile(original) }, encoding: "utf8", stdio: "pipe" }
  );
} catch (_) {
  // tsx approach instead
}
// Use tsx directly to verify clean load
try {
  const out = execSync("npx tsx -e \"import './src/lib/env.ts'; console.log('env loaded ok')\"", {
    encoding: "utf8",
    env: { ...process.env, ...parseEnvFile(original) },
  });
  console.log("PASS:", out.trim());
} catch (e: any) {
  console.error("FAIL: env failed to load with valid vars");
  console.error(e.stderr || e.stdout);
  process.exit(1);
}

console.log("\nF01 verification: ALL PASS");

function parseEnvFile(content: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) env[m[1]] = m[2].trim();
  }
  return env;
}
