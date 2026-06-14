/**
 * E4 verification:
 *   1. CATEGORY_SEVERITY_FLOOR covers all 14 expected sectors.
 *   2. Each sector's floor matches the minimum severity from rules.ts.
 *   3. applySeverityFloor (via mergeAndDedupe) bumps low→floor when below floor.
 *   4. Cross-layer dedup: L4 heuristic at same sector+module+line as L1 is removed.
 *   5. L4 with corpus match is kept even when L1 covers same sector+module+line.
 */

import { mergeAndDedupe } from "../src/lib/audit/engine";
import type { Finding } from "../src/lib/audit/schema";

// ── helpers ──────────────────────────────────────────────────────────────────

function makeFinding(overrides: Partial<Finding> & Pick<Finding, "rule_id" | "module" | "line_start" | "severity">): Finding {
  return {
    confidence:     1.0,
    category:       "test",
    description:    "test finding",
    recommendation: "",
    line_end:       overrides.line_start + 1,
    source:         "layer1",
    ...overrides,
  } as Finding;
}

let passed = 0;
let failed = 0;

function check(label: string, ok: boolean) {
  if (ok) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}`);
    failed++;
  }
}

// ── Test 1: floor map coverage ────────────────────────────────────────────────

console.log("\nTest 1: CATEGORY_SEVERITY_FLOOR sector coverage");

// We can't import the private const directly, so we verify via mergeAndDedupe:
// inject a "low" finding for each sector and check that it is bumped up.

const EXPECTED_FLOORS: Record<string, string> = {
  "ML-INT": "high",
  "ML-OZ":  "high",
  "ML-ACC": "medium",
  "ML-ARI": "medium",
  "ML-HOT": "high",
  "ML-OWN": "medium",
  "ML-UPG": "medium",
  "ML-RAC": "low",
  "ML-RET": "medium",
  "ML-TOK": "medium",
  "ML-WRP": "medium",
  "ML-DOS": "low",
  "ML-DEP": "medium",
  "ML-LOG": "low",
};

// Floor should not go BELOW the expected floor.
for (const [sector, floor] of Object.entries(EXPECTED_FLOORS)) {
  const ruleId = `${sector}-${sector === "ML-OZ" ? "001" : "001"}`; // e.g. ML-INT-001
  const finding = makeFinding({ rule_id: ruleId, module: "mod", line_start: 1, severity: "low" });
  const result = mergeAndDedupe([finding]);
  const actual = result[0]?.severity;
  if (floor === "low") {
    check(`${sector}: low stays low`, actual === "low");
  } else {
    check(`${sector}: low bumped to ${floor}`, actual === floor);
  }
}

// ── Test 2: floor doesn't lower existing high severity ─────────────────────

console.log("\nTest 2: floor never lowers a finding that's already above the floor");

{
  const f = makeFinding({ rule_id: "ML-LOG-001", module: "mod", line_start: 1, severity: "critical" });
  const result = mergeAndDedupe([f]);
  check("ML-LOG critical stays critical", result[0]?.severity === "critical");
}

// ── Test 3: cross-layer dedup — L4 heuristic dropped when L1 covers same sector ──

console.log("\nTest 3: cross-layer sector dedup — L4 heuristic removed when L1 covers same sector+module+line");

{
  const l1 = makeFinding({
    rule_id:     "ML-INT-001",
    module:      "vault",
    line_start:  10,
    severity:    "critical",
    source:      "layer1",
    description: "L1 finding",
  });
  const l4 = makeFinding({
    rule_id:     "ML-INT-L4-001",
    module:      "vault",
    line_start:  11, // within ±2
    severity:    "high",
    source:      "layer4",
    description: "L4 heuristic fallback",
  });
  const result = mergeAndDedupe([l1, l4]);
  check("Only 1 finding after dedup", result.length === 1);
  check("Kept finding is L1 (ML-INT-001)", result[0]?.rule_id === "ML-INT-001");
}

// ── Test 4: cross-layer dedup — L4 with corpus match kept ─────────────────

console.log("\nTest 4: L4 with corpus match kept even when L1 covers same sector+module+line");

{
  const l1 = makeFinding({
    rule_id:     "ML-INT-001",
    module:      "vault",
    line_start:  10,
    severity:    "critical",
    source:      "layer1",
    description: "L1 finding",
  });
  const l4 = makeFinding({
    rule_id:     "ML-INT-L4-001",
    module:      "vault",
    line_start:  10,
    severity:    "high",
    source:      "layer4",
    description: '[Layer 4] Similar to known vulnerability "integer overflow" (sim=0.91). Checked shift overflow.',
  });
  const result = mergeAndDedupe([l1, l4]);
  check("Both findings kept (corpus match on L4)", result.length === 2);
}

// ── Test 5: cross-layer dedup — L4 not deduped when module differs ──────────

console.log("\nTest 5: L4 not deduped when module differs");

{
  const l1 = makeFinding({
    rule_id:    "ML-INT-001",
    module:     "vault",
    line_start: 10,
    severity:   "critical",
    source:     "layer1",
    description: "L1 finding",
  });
  const l4 = makeFinding({
    rule_id:    "ML-INT-L4-001",
    module:     "admin",
    line_start: 10,
    severity:   "high",
    source:     "layer4",
    description: "L4 heuristic fallback",
  });
  const result = mergeAndDedupe([l1, l4]);
  check("Both findings kept (different modules)", result.length === 2);
}

// ── Test 6: cross-layer dedup — L4 not deduped when line gap > 2 ──────────

console.log("\nTest 6: L4 not deduped when line gap > 2");

{
  const l1 = makeFinding({
    rule_id:    "ML-INT-001",
    module:     "vault",
    line_start: 10,
    severity:   "critical",
    source:     "layer1",
    description: "L1 finding",
  });
  const l4 = makeFinding({
    rule_id:    "ML-INT-L4-001",
    module:     "vault",
    line_start: 15, // gap = 5
    severity:   "high",
    source:     "layer4",
    description: "L4 heuristic fallback",
  });
  const result = mergeAndDedupe([l1, l4]);
  check("Both findings kept (line gap > 2)", result.length === 2);
}

// ── summary ──────────────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(40)}`);
console.log(`Passed: ${passed}  Failed: ${failed}`);
if (failed > 0) process.exit(1);
