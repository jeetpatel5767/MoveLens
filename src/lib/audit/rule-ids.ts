// Auto-generated from movelens_vuln_corpus_classified.md — do NOT edit IDs manually.
// 93 canonical Layer 1 rule IDs across 13 sectors + 10 Layer 2 OZ benchmark IDs.
// Only the `passes` field in features.json may change; IDs are immutable.

export const VALID_RULE_IDS: ReadonlySet<string> = new Set([
  // SECTOR: Access Control & Visibility (13)
  "ML-ACC-001", "ML-ACC-002", "ML-ACC-003", "ML-ACC-004", "ML-ACC-005",
  "ML-ACC-006", "ML-ACC-007", "ML-ACC-008", "ML-ACC-009", "ML-ACC-010",
  "ML-ACC-011", "ML-ACC-012", "ML-ACC-013",
  // SECTOR: Object Ownership & Permission Checks (13)
  "ML-OBJ-001", "ML-OBJ-002", "ML-OBJ-003", "ML-OBJ-004", "ML-OBJ-005",
  "ML-OBJ-006", "ML-OBJ-007", "ML-OBJ-008", "ML-OBJ-009", "ML-OBJ-010",
  "ML-OBJ-011", "ML-OBJ-012", "ML-OBJ-013",
  // SECTOR: Integer Overflow & Bitwise Arithmetic (6)
  "ML-INT-001", "ML-INT-002", "ML-INT-003", "ML-INT-004", "ML-INT-005",
  "ML-INT-006",
  // SECTOR: Arithmetic Precision Loss (7)
  "ML-ARI-001", "ML-ARI-002", "ML-ARI-003", "ML-ARI-004", "ML-ARI-005",
  "ML-ARI-006", "ML-ARI-007",
  // SECTOR: Hot Potato / Flash Loan Misuse (4)
  "ML-HOT-001", "ML-HOT-002", "ML-HOT-003", "ML-HOT-004",
  // SECTOR: Unsafe Upgrade Patterns (4)
  "ML-UPG-001", "ML-UPG-002", "ML-UPG-003", "ML-UPG-004",
  // SECTOR: Race Conditions / Transaction Ordering (3)
  "ML-RAC-001", "ML-RAC-002", "ML-RAC-003",
  // SECTOR: Unchecked Return Values (4)
  "ML-RET-001", "ML-RET-002", "ML-RET-003", "ML-RET-004",
  // SECTOR: Token / Coin Management (8)
  "ML-TOK-001", "ML-TOK-002", "ML-TOK-003", "ML-TOK-004", "ML-TOK-005",
  "ML-TOK-006", "ML-TOK-007", "ML-TOK-008",
  // SECTOR: Object Wrapping / Unwrapping (3)
  "ML-WRP-001", "ML-WRP-002", "ML-WRP-003",
  // SECTOR: Denial of Service (4)
  "ML-DOS-001", "ML-DOS-002", "ML-DOS-003", "ML-DOS-004",
  // SECTOR: External Module / Dependency Security (4)
  "ML-EXT-001", "ML-EXT-002", "ML-EXT-003", "ML-EXT-004",
  // SECTOR: Design Logic Flaws (20)
  "ML-LOG-001", "ML-LOG-002", "ML-LOG-003", "ML-LOG-004", "ML-LOG-005",
  "ML-LOG-006", "ML-LOG-007", "ML-LOG-008", "ML-LOG-009", "ML-LOG-010",
  "ML-LOG-011", "ML-LOG-012", "ML-LOG-013", "ML-LOG-014", "ML-LOG-015",
  "ML-LOG-016", "ML-LOG-017", "ML-LOG-018", "ML-LOG-019", "ML-LOG-020",
  // LAYER 2 — OpenZeppelin benchmark deviations (10)
  "ML-OZ-001", "ML-OZ-002", "ML-OZ-003", "ML-OZ-004", "ML-OZ-005",
  "ML-OZ-006", "ML-OZ-007", "ML-OZ-008", "ML-OZ-009", "ML-OZ-010",
]);

/** Layer 1 corpus size — must always be 93. Checked at runtime in rules.ts. */
export const RULE_COUNT = 93;

/** Layer 2 OZ benchmark size — must always be 10. */
export const OZ_RULE_COUNT = 10;
