// F07 verification — all 3 steps
// Step 1: all four .move files exist in test/fixtures/
// Step 2: each has a sibling expected.json with required rule_ids
// Step 3: each .move file is under 80 lines and contains a module declaration

import * as fs from "fs";
import * as path from "path";

function pass(msg: string) { console.log("PASS", msg); }
function fail(msg: string) { console.error("FAIL", msg); process.exit(1); }

const FIXTURES_DIR = path.join(__dirname, "fixtures");

const FIXTURES: {
  name: string;
  must_find: string[];
  must_not_find_above: string | null;
}[] = [
  {
    name: "vulnerable_cap",
    must_find: ["ML-ACC-008", "ML-UPG-001"],
    must_not_find_above: null,
  },
  {
    name: "missing_signer",
    must_find: ["ML-ACC-001"],
    must_not_find_above: null,
  },
  {
    name: "overflow",
    must_find: ["ML-INT-001", "ML-INT-002", "ML-INT-003"],
    must_not_find_above: null,
  },
  {
    name: "clean",
    must_find: [],
    must_not_find_above: "low",
  },
];

async function main() {
  let passed = 0;

  // ── Step 1: all four .move files exist ────────────────────────────────────

  for (const fix of FIXTURES) {
    const movePath = path.join(FIXTURES_DIR, `${fix.name}.move`);
    if (!fs.existsSync(movePath)) {
      fail(`step1: ${fix.name}.move not found at ${movePath}`);
    }
  }
  pass(`step1: all 4 .move fixtures exist in test/fixtures/`);
  passed++;

  // ── Step 2: each has a valid expected.json ─────────────────────────────────

  for (const fix of FIXTURES) {
    const jsonPath = path.join(FIXTURES_DIR, fix.name, "expected.json");
    if (!fs.existsSync(jsonPath)) {
      fail(`step2: ${fix.name}/expected.json not found at ${jsonPath}`);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
    } catch (e) {
      fail(`step2: ${fix.name}/expected.json is not valid JSON: ${e}`);
      return;
    }

    if (typeof parsed !== "object" || parsed === null) {
      fail(`step2: ${fix.name}/expected.json must be an object`);
    }
    const obj = parsed as Record<string, unknown>;

    // must_find must be an array
    if (!Array.isArray(obj.must_find)) {
      fail(`step2: ${fix.name}/expected.json missing or invalid "must_find" array`);
    }
    const mustFind: string[] = obj.must_find as string[];

    // Verify expected rule_ids match our fixture spec
    const expectedSorted = [...fix.must_find].sort();
    const actualSorted   = [...mustFind].sort();
    if (JSON.stringify(expectedSorted) !== JSON.stringify(actualSorted)) {
      fail(
        `step2: ${fix.name}/expected.json must_find mismatch.\n` +
        `  Expected: ${JSON.stringify(expectedSorted)}\n` +
        `  Got:      ${JSON.stringify(actualSorted)}`
      );
    }

    // must_not_find_above must be null or a valid severity string
    const mna = obj.must_not_find_above;
    const validAbove = [null, "low", "medium", "high", "critical"];
    if (!validAbove.includes(mna as string | null)) {
      fail(
        `step2: ${fix.name}/expected.json "must_not_find_above" must be null or ` +
        `one of ${JSON.stringify(validAbove.filter(Boolean))}, got ${JSON.stringify(mna)}`
      );
    }
    if (mna !== fix.must_not_find_above) {
      fail(
        `step2: ${fix.name}/expected.json must_not_find_above mismatch.\n` +
        `  Expected: ${JSON.stringify(fix.must_not_find_above)}\n` +
        `  Got:      ${JSON.stringify(mna)}`
      );
    }
  }
  pass(`step2: all 4 expected.json files exist with correct rule_ids and must_not_find_above`);
  passed++;

  // ── Step 3: line count < 80 and module declaration present ────────────────

  for (const fix of FIXTURES) {
    const movePath = path.join(FIXTURES_DIR, `${fix.name}.move`);
    const content  = fs.readFileSync(movePath, "utf-8");
    const lines    = content.split("\n");

    if (lines.length > 80) {
      fail(`step3: ${fix.name}.move has ${lines.length} lines — must be ≤ 80`);
    }

    if (!/^\s*module\s+\w+::\w+/m.test(content)) {
      fail(`step3: ${fix.name}.move has no module declaration`);
    }
  }

  // Summarise line counts
  for (const fix of FIXTURES) {
    const movePath = path.join(FIXTURES_DIR, `${fix.name}.move`);
    const lines    = fs.readFileSync(movePath, "utf-8").split("\n").length;
    console.log(`       ${fix.name}.move: ${lines} lines`);
  }

  pass(`step3: all 4 fixtures are ≤ 80 lines and contain a module declaration`);
  passed++;

  console.log(`\nF07: ${passed}/3 steps passed ✓`);
  console.log(`Fixtures: ${FIXTURES.map(f => f.name + ".move").join(", ")}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
