// F06 verification — all 3 steps
// Step 1: rules.ts contains all REGEX+AST rules from corpus across 13 sector prefixes
// Step 2: Finding schema rejects an unknown rule_id
// Step 3: AuditReport schema requires the exact watermark string

import { RULES, RULE_REGISTRY } from "../src/lib/audit/rules";
import { VALID_RULE_IDS, RULE_COUNT, OZ_RULE_COUNT } from "../src/lib/audit/rule-ids";
import { FindingSchema, AuditReportSchema, WATERMARK } from "../src/lib/audit/schema";

function pass(msg: string) { console.log("PASS", msg); }
function fail(msg: string) { console.error("FAIL", msg); process.exit(1); }

async function main() {
  let passed = 0;

  // ── Step 1: rules.ts contents ──────────────────────────────────────────────

  const SECTOR_PREFIXES = [
    "ML-ACC", "ML-OBJ", "ML-INT", "ML-ARI", "ML-HOT",
    "ML-UPG", "ML-RAC", "ML-RET", "ML-TOK", "ML-WRP",
    "ML-DOS", "ML-EXT", "ML-LOG",
  ] as const;

  for (const prefix of SECTOR_PREFIXES) {
    const count = RULES.filter((r) => r.id.startsWith(prefix)).length;
    if (count === 0) {
      fail(`step1: sector ${prefix} has 0 rules — all 13 sectors required`);
    }
  }

  if (RULES.length !== RULE_COUNT) {
    fail(`step1: RULES.length=${RULES.length}, expected ${RULE_COUNT}`);
  }

  const regexRules = RULES.filter((r) => r.type === "regex");
  const astRules   = RULES.filter((r) => r.type === "ast");
  const skipRules  = RULES.filter((r) => r.type === "skip_mvp");

  if (regexRules.length !== 65) {
    fail(`step1: Expected 65 REGEX rules, got ${regexRules.length}`);
  }
  if (astRules.length !== 19) {
    fail(`step1: Expected 19 AST rules, got ${astRules.length}`);
  }
  if (skipRules.length !== 9) {
    fail(`step1: Expected 9 SKIP_MVP rules, got ${skipRules.length}`);
  }

  // VALID_RULE_IDS includes the 93 Layer 1 corpus rules + 10 Layer 2 OZ rules
  if (VALID_RULE_IDS.size !== RULE_COUNT + OZ_RULE_COUNT) {
    fail(`step1: VALID_RULE_IDS.size=${VALID_RULE_IDS.size}, expected ${RULE_COUNT + OZ_RULE_COUNT} (${RULE_COUNT} L1 + ${OZ_RULE_COUNT} OZ)`);
  }

  // All RULES IDs must be in VALID_RULE_IDS
  for (const rule of RULES) {
    if (!VALID_RULE_IDS.has(rule.id)) {
      fail(`step1: Rule ${rule.id} missing from VALID_RULE_IDS`);
    }
  }

  // RULE_REGISTRY must have same count
  if (RULE_REGISTRY.size !== RULE_COUNT) {
    fail(`step1: RULE_REGISTRY.size=${RULE_REGISTRY.size}, expected ${RULE_COUNT}`);
  }

  // All REGEX rules must have a compiled pattern
  for (const rule of regexRules) {
    if (!(rule.pattern instanceof RegExp)) {
      fail(`step1: REGEX rule ${rule.id} missing compiled RegExp pattern`);
    }
  }

  pass(`step1: 93 rules (65 REGEX + 19 AST + 9 SKIP_MVP), 13 sectors present, all IDs registered`);
  passed++;

  // ── Step 2: Finding schema rejects unknown rule_id ─────────────────────────

  const baseFinding = {
    severity: "high" as const,
    confidence: 0.9,
    source: "layer1" as const,
    module: "test_module",
    line_start: 1,
    line_end: 5,
    description: "test description",
    recommendation: "fix it",
    category: "access_control",
  };

  // Well-formed but NOT in registry
  const r1 = FindingSchema.safeParse({ ...baseFinding, rule_id: "ML-ZZZ-999" });
  if (r1.success) {
    fail(`step2: FindingSchema accepted unknown rule_id "ML-ZZZ-999" — registry check failed`);
  }

  // Completely malformed
  const r2 = FindingSchema.safeParse({ ...baseFinding, rule_id: "notaruleid" });
  if (r2.success) {
    fail(`step2: FindingSchema accepted malformed rule_id "notaruleid"`);
  }

  // Wrong format (no number)
  const r3 = FindingSchema.safeParse({ ...baseFinding, rule_id: "ML-ACC-ABC" });
  if (r3.success) {
    fail(`step2: FindingSchema accepted "ML-ACC-ABC" (non-numeric suffix)`);
  }

  // Valid known rule must succeed
  const r4 = FindingSchema.safeParse({
    ...baseFinding,
    rule_id: "ML-INT-001",
    severity: "critical",
    confidence: 1.0,
    description: "Cetus-class bitwise shift overflow",
    recommendation: "Use 1u256 << N as mask",
    category: "integer_overflow",
  });
  if (!r4.success) {
    fail(`step2: FindingSchema rejected valid rule_id "ML-INT-001": ${JSON.stringify(r4.error.issues)}`);
  }

  pass(`step2: FindingSchema rejects unknown/malformed IDs; accepts known "ML-INT-001"`);
  passed++;

  // ── Step 3: AuditReport watermark enforcement ──────────────────────────────

  const baseReport = {
    report_id: "550e8400-e29b-41d4-a716-446655440000",
    generated_at: new Date().toISOString(),
    package: {
      packageId: "0x2",
      network: "testnet" as const,
      mvrName: null,
      version: 1,
      moduleCount: 5,
      fetchedAt: new Date().toISOString(),
    },
    findings: [],
    severity_counts: { critical: 0, high: 0, medium: 0, low: 0 },
    risk_grade: "A" as const,
    watermark: WATERMARK,
    memory_context_used: false,
    layer4_used: false,
    sealed: false,
  };

  // Correct watermark — must pass
  const r5 = AuditReportSchema.safeParse(baseReport);
  if (!r5.success) {
    fail(`step3: AuditReport with correct watermark failed: ${JSON.stringify(r5.error.issues)}`);
  }

  // Wrong watermark — must fail
  const r6 = AuditReportSchema.safeParse({ ...baseReport, watermark: "wrong watermark" });
  if (r6.success) {
    fail(`step3: AuditReport with wrong watermark should fail but passed`);
  }

  // Missing watermark — must fail
  const { watermark: _w, ...noWatermark } = baseReport;
  const r7 = AuditReportSchema.safeParse(noWatermark);
  if (r7.success) {
    fail(`step3: AuditReport with missing watermark should fail but passed`);
  }

  // Empty string watermark — must fail
  const r8 = AuditReportSchema.safeParse({ ...baseReport, watermark: "" });
  if (r8.success) {
    fail(`step3: AuditReport with empty watermark should fail but passed`);
  }

  pass(`step3: AuditReport enforces exact watermark "${WATERMARK.slice(0, 40)}..."`);
  passed++;

  console.log(`\nF06: ${passed}/3 steps passed ✓`);
  console.log(`Registry stats: ${RULES.length} rules, ${VALID_RULE_IDS.size} IDs, WATERMARK="${WATERMARK}"`);
}

main().catch((e) => { console.error(e); process.exit(1); });
