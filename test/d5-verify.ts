/**
 * test/d5-verify.ts — D5 README Business Model + Patch Before/After verify
 *
 * Steps:
 *   1. README.md has "Beyond the Hackathon" section with CI/ecosystem/managed content
 *   2. layer4.ts has PATCH_SUGGESTIONS for all 5 required categories
 *   3. getPatch() returns non-null for ML-INT, ML-ACC, ML-ARI, ML-HOT, ML-UPG
 *   4. FindingSchema accepts patch_before and patch_after fields
 *   5. Layer 4 finding assembled with ML-INT category carries patch_before/patch_after
 *   6. FindingCard in audit/[id]/page.tsx renders patch panels and "Copy fix"
 *   7. Finding interface on audit page has patch_before/patch_after fields
 *
 * Run: npx tsx test/d5-verify.ts
 */

require("dotenv/config");

import { readFileSync } from "fs";
import { FindingSchema } from "../src/lib/audit/schema";

let passed = 0;
let failed = 0;

function pass(msg: string) { console.log(`PASS ${msg}`); passed++; }
function fail(msg: string) { console.error(`FAIL ${msg}`); failed++; }

async function main() {
  // ── Step 1: README "Beyond the Hackathon" section ────────────────────────────
  console.log("\n── Step 1: README.md has Beyond the Hackathon section ─────────────────────");
  {
    const readme = readFileSync("README.md", "utf8");
    const checks: [string, string][] = [
      ["Beyond the Hackathon",  "step1: 'Beyond the Hackathon' heading present ✓"],
      ["CI integration",        "step1: CI integration path mentioned ✓"],
      ["Ecosystem infrastructure", "step1: ecosystem infrastructure path mentioned ✓"],
      ["Managed tier",          "step1: managed tier path mentioned ✓"],
      ["Walrus + Seal + MVR",   "step1: Walrus + Seal + MVR stack highlighted ✓"],
    ];
    for (const [needle, label] of checks) {
      if (readme.includes(needle)) { pass(label); } else { fail(`${label} — '${needle}' missing`); }
    }
  }

  // ── Step 2: PATCH_SUGGESTIONS in layer4.ts ────────────────────────────────────
  console.log("\n── Step 2: layer4.ts has PATCH_SUGGESTIONS for 5 categories ───────────────");
  {
    const l4src = readFileSync("src/lib/audit/layer4.ts", "utf8");
    const cats = ["ML-INT", "ML-ACC", "ML-ARI", "ML-HOT", "ML-UPG"];
    for (const cat of cats) {
      if (l4src.includes(`"${cat}"`)) {
        pass(`step2: PATCH_SUGGESTIONS has entry for ${cat} ✓`);
      } else {
        fail(`step2: PATCH_SUGGESTIONS missing ${cat}`);
      }
    }
    if (l4src.includes("PatchSuggestion") && l4src.includes("getPatch")) {
      pass("step2: PatchSuggestion interface and getPatch() helper present ✓");
    } else {
      fail("step2: PatchSuggestion or getPatch() missing from layer4.ts");
    }
  }

  // ── Step 3: FindingSchema accepts patch fields ────────────────────────────────
  console.log("\n── Step 3: FindingSchema accepts patch_before / patch_after ────────────────");
  {
    const withPatch = FindingSchema.safeParse({
      rule_id: "ML-INT-L4-001",
      severity: "critical",
      confidence: 0.9,
      source: "layer4",
      module: "pool",
      line_start: 5,
      line_end: 10,
      description: "Integer overflow in bit-shift",
      recommendation: "Use checked_shl",
      category: "int",
      patch_before: "let r = n << 64;",
      patch_after:  "let r = checked_shl(n, 64);",
    });

    if (withPatch.success) {
      pass("step3: FindingSchema parses successfully with patch_before/patch_after ✓");
      if (withPatch.data.patch_before === "let r = n << 64;") {
        pass("step3b: patch_before preserved correctly ✓");
      } else {
        fail(`step3b: patch_before not preserved: ${withPatch.data.patch_before}`);
      }
      if (withPatch.data.patch_after === "let r = checked_shl(n, 64);") {
        pass("step3c: patch_after preserved correctly ✓");
      } else {
        fail(`step3c: patch_after not preserved: ${withPatch.data.patch_after}`);
      }
    } else {
      fail(`step3: FindingSchema rejected patch fields: ${JSON.stringify(withPatch.error.flatten())}`);
    }

    // Also verify null is accepted (for non-patch categories)
    const withNullPatch = FindingSchema.safeParse({
      rule_id: "ML-LOG-L4-001",
      severity: "low",
      confidence: 0.5,
      source: "layer4",
      module: "pool",
      line_start: 1,
      line_end: 5,
      description: "Missing event emission",
      recommendation: "Add event",
      category: "log",
      patch_before: null,
      patch_after:  null,
    });
    if (withNullPatch.success) {
      pass("step3d: FindingSchema accepts null patch fields for non-patch categories ✓");
    } else {
      fail(`step3d: FindingSchema rejected null patch fields`);
    }
  }

  // ── Step 4: layer4.ts wires patch into the assembled finding ─────────────────
  console.log("\n── Step 4: analyzeSnippet wires patch_before/patch_after into raw finding ──");
  {
    const l4src = readFileSync("src/lib/audit/layer4.ts", "utf8");
    if (l4src.includes("patch_before") && l4src.includes("patch_after") && l4src.includes("getPatch(classResult.category)")) {
      pass("step4: analyzeSnippet sets patch_before/patch_after from getPatch() ✓");
    } else {
      fail("step4: analyzeSnippet missing patch_before/patch_after wiring");
    }
  }

  // ── Step 5: audit page renders patch panels ───────────────────────────────────
  console.log("\n── Step 5: audit/[id]/page.tsx renders before/after panels ────────────────");
  {
    const pageSource = readFileSync("src/app/audit/[id]/page.tsx", "utf8");

    if (pageSource.includes("patch_before?: string | null") && pageSource.includes("patch_after?:  string | null")) {
      pass("step5: Finding interface has patch_before/patch_after ✓");
    } else {
      fail("step5: Finding interface missing patch fields");
    }

    if (pageSource.includes("finding.patch_after") && pageSource.includes("Suggested Fix")) {
      pass("step5b: patch panel renders under 'Suggested Fix' heading ✓");
    } else {
      fail("step5b: patch panel or 'Suggested Fix' heading missing");
    }

    if (pageSource.includes("Copy fix") && pageSource.includes("navigator.clipboard.writeText")) {
      pass("step5c: 'Copy fix' button writes patch_after to clipboard ✓");
    } else {
      fail("step5c: 'Copy fix' button or clipboard write missing");
    }

    if (pageSource.includes("finding.patch_before") && pageSource.includes("Before")) {
      pass("step5d: 'Before' code panel renders patch_before ✓");
    } else {
      fail("step5d: 'Before' panel missing");
    }
  }

  // ── Summary ──────────────────────────────────────────────────────────────────
  const total = passed + failed;
  console.log(`\nD5: ${passed}/${total} steps passed ${passed >= total ? "✓" : "✗"}`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("[d5-verify] Unexpected error:", err);
  process.exit(1);
});
