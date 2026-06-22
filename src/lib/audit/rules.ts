// Rule registry — 93 rules parsed from movelens_vuln_corpus_classified.md.
// 65 REGEX rules (deterministic, compiled RegExp), 19 AST rules (Move parser stubs),
// 9 SKIP_MVP rules (deferred — too complex for hackathon).
//
// HARD RULES:
//   - Never emit a finding with a rule_id not present in this registry.
//   - Never remove or rename an entry — only add.
//   - AST rules have pattern = undefined; Layer 1 skips them until Move AST parser exists.

import type { Severity } from "./schema";
import { VALID_RULE_IDS, RULE_COUNT } from "./rule-ids";

// ──────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────

export type RuleType = "regex" | "ast" | "skip_mvp";

export type Category =
  | "access_control"
  | "object_ownership"
  | "integer_overflow"
  | "arithmetic_precision"
  | "hot_potato"
  | "unsafe_upgrade"
  | "race_condition"
  | "unchecked_return"
  | "token_management"
  | "object_wrapping"
  | "denial_of_service"
  | "dependency_security"
  | "design_logic";

export interface Rule {
  /** Canonical ID — must exist in rule-ids.ts VALID_RULE_IDS */
  id: string;
  type: RuleType;
  /** Compiled RegExp for REGEX rules; undefined for AST/SKIP_MVP. */
  pattern?: RegExp;
  severity: Severity;
  description: string;
  recommendation: string;
  category: Category;
}

// ──────────────────────────────────────────────────────────────
// SECTOR: Access Control & Visibility  (ML-ACC-001 … ML-ACC-013)
// ──────────────────────────────────────────────────────────────

const ACC_RULES: Rule[] = [
  {
    id: "ML-ACC-001",
    type: "regex",
    // Matches public fun AND public entry fun without a capability in the param list.
    // Gate (Groq) dismisses legitimate open functions (getters, deposits).
    // The pattern checks the parameter list on the same line — no cross-line lookahead issues.
    pattern: /public\s+(?:entry\s+)?fun\s+\w+[^(]*\((?![^)]*(?:AdminCap|OwnerCap|[A-Z]\w*Cap\b))[^)]*\)/gm,
    severity: "high",
    description: "Public function with no capability parameter — callable without an authorization guard.",
    recommendation: "Add `_: &AdminCap` parameter or assert `ctx.sender()` inside the body before any privileged state mutation.",
    category: "access_control",
  },
  {
    id: "ML-ACC-002",
    type: "regex",
    pattern: /public\(package\)\s+(?:entry\s+)?fun\s+\w+[^(]*\([^)]*\)(?!.*(?:AdminCap|OwnerCap)).*(?:transfer|mint|withdraw|delete)/gm,
    severity: "high",
    description: "public(package) used as security boundary without capability check on high-value operation.",
    recommendation: "Add `_: &AdminCap` or equivalent typed capability as parameter.",
    category: "access_control",
  },
  {
    id: "ML-ACC-003",
    type: "regex",
    pattern: /assert!\s*\(\s*ctx\.sender\(\)\s*==\s*@0x[0-9a-fA-F]+/gm,
    severity: "medium",
    description: "Hardcoded address used for access control — brittle and not key-rotatable.",
    recommendation: "Replace with capability pattern: `struct AdminCap has key {}` transferred to deployer in init.",
    category: "access_control",
  },
  {
    id: "ML-ACC-004",
    type: "ast",
    severity: "critical",
    description: "Generic capability struct with unconstrained type param — phantom type substitution attack possible.",
    recommendation: "Use concrete capability types; add phantom constraint or runtime type assertion.",
    category: "access_control",
  },
  {
    id: "ML-ACC-005",
    type: "regex",
    pattern: /assert!\s*\(\s*\w+\s*==\s*\w+\.(admin|owner)/gm,
    severity: "critical",
    description: "Caller vs sender confusion — access control assert uses passed-in address, not ctx.sender().",
    recommendation: "Always derive authority from ctx.sender() or an owned capability, never from address arguments.",
    category: "access_control",
  },
  {
    id: "ML-ACC-006",
    type: "ast",
    severity: "high",
    description: "Public/entry function takes &mut T (shared object) with no capability or sender check.",
    recommendation: "Require `&AdminCap` or verify `ctx.sender()` before mutating shared objects.",
    category: "access_control",
  },
  {
    id: "ML-ACC-007",
    type: "regex",
    pattern: /struct\s+\w*[Cc]ap\w*\s+has\s+[^{]*(store|copy)/gm,
    severity: "high",
    description: "Capability struct has `store` or `copy` ability — can be duplicated or moved to shared storage.",
    recommendation: "Remove `store` and `copy`; capabilities should only have `key` ability.",
    category: "access_control",
  },
  {
    id: "ML-ACC-008",
    type: "regex",
    pattern: /fun\s+\w+[^(]*\([^)]*UpgradeCap[^)]*\)(?!.*package::upgrade_package)/gm,
    severity: "critical",
    description: "Non-exclusive framework capability (UpgradeCap) used as auth gate without validating package ID — Pawtato class.",
    recommendation: "Call `package::upgrade_package(&cap)` and assert the returned package ID matches @expected.",
    category: "access_control",
  },
  {
    id: "ML-ACC-009",
    type: "ast",
    severity: "high",
    description: "Capability-minting function guarded by weaker check than the privileges it confers.",
    recommendation: "Gate capability creation with checks equal to or stronger than the returned capability.",
    category: "access_control",
  },
  {
    id: "ML-ACC-010",
    type: "regex",
    pattern: /entry\s+fun\s+\w+[^(]*\([^)]*\)(?!.*(?:AdminCap|ctx\.sender)).*(?:transfer|withdraw|delete)/gm,
    severity: "high",
    description: "`entry` modifier makes function callable by any PTB despite intended restriction.",
    recommendation: "Remove `entry` from internal helpers; add capability or sender check to all entry points.",
    category: "access_control",
  },
  {
    id: "ML-ACC-011",
    type: "ast",
    severity: "high",
    description: "Generic witness W:drop in policy function without has_rule verification.",
    recommendation: "Verify witness type with `has_rule<T, Rule>` before accepting policy authorization.",
    category: "access_control",
  },
  {
    id: "ML-ACC-012",
    type: "ast",
    severity: "critical",
    description: "Signer or SignerCapability passed to or stored by untrusted external module.",
    recommendation: "Never expose SignerCapability or pass &signer to external/untrusted modules.",
    category: "access_control",
  },
  {
    id: "ML-ACC-013",
    type: "skip_mvp",
    severity: "medium",
    description: "Resource account or derived address pre-claim squatting via predictable seeds. (SKIP_MVP)",
    recommendation: "Use unpredictable/hard-coded package seeds; verify target address has no pre-existing balance.",
    category: "access_control",
  },
];

// ──────────────────────────────────────────────────────────────
// SECTOR: Object Ownership & Permission Checks  (ML-OBJ-001 … ML-OBJ-013)
// ──────────────────────────────────────────────────────────────

const OBJ_RULES: Rule[] = [
  {
    id: "ML-OBJ-001",
    type: "regex",
    // Narrowed to shared-object type names (Pool/Vault/Treasury/Market/Config/State) — these are the objects
    // where missing owner checks are most dangerous. Plain `&mut T` on any type was too broad.
    pattern: /public\s+(?:entry\s+)?fun\s+\w+[^(]*\(&mut\s+\w*(?:Pool|Vault|Treasury|Market|Config|State|Registry|Store)\w*[^)]*\)/gm,
    severity: "high",
    description: "Public function mutates a shared object (&mut Pool/Vault/Market) — verify ctx.sender() has authority.",
    recommendation: "Add `assert!(obj.owner == ctx.sender(), ENotOwner);` or require a capability parameter before any mutation.",
    category: "object_ownership",
  },
  {
    id: "ML-OBJ-002",
    type: "regex",
    pattern: /transfer::(?:public_)?share_object\s*\(\s*\w*(?:[Bb]alance|[Vv]ault|[Aa]ccount|[Ww]allet)\w*/gm,
    severity: "high",
    description: "Per-user sensitive object (balance/vault/account/wallet) shared instead of transferred to owner.",
    recommendation: "Use transfer::transfer(obj, ctx.sender()) for per-user objects.",
    category: "object_ownership",
  },
  {
    id: "ML-OBJ-003",
    type: "regex",
    pattern: /fun\s+\w+[^(]*\(&\s+\w+[^)]*\).*dynamic_field::(?:add|remove)/gm,
    severity: "high",
    description: "Function takes immutable reference &T but mutates interior state via dynamic_field::add/remove.",
    recommendation: "Use &mut T explicitly for any operation that modifies the object's logical state.",
    category: "object_ownership",
  },
  {
    id: "ML-OBJ-004",
    type: "regex",
    pattern: /struct\s+\w*(?:[Rr]eceipt|[Cc]ap|[Vv]oucher)\w*\s+has\s+[^{]*\bdrop\b/gm,
    severity: "critical",
    description: "Withdrawal/privileged capability has `drop` ability — can be dropped without consuming, enabling reuse.",
    recommendation: "Define single-use receipts as hot potatoes (no abilities) or track nonce/epoch.",
    category: "object_ownership",
  },
  {
    id: "ML-OBJ-005",
    type: "regex",
    pattern: /transfer::(?:public_)?share_object\s*\(\s*\w*(?:[Aa]dmin|[Oo]wner|[Cc]ap)\w*/gm,
    severity: "critical",
    description: "AdminCap/OwnerCap shared via share_object — makes privileged functions publicly accessible.",
    recommendation: "Transfer capabilities to deployer in init: `transfer::transfer(cap, ctx.sender())`.",
    category: "object_ownership",
  },
  {
    id: "ML-OBJ-006",
    type: "ast",
    severity: "high",
    description: "Type with custom transfer function also declares `store` ability — allows public_transfer bypass.",
    recommendation: "Remove `store` from structs requiring custom transfer verification.",
    category: "object_ownership",
  },
  {
    id: "ML-OBJ-007",
    type: "regex",
    pattern: /let\s+\w+\s*=\s*\w+\.id;(?!.*object::delete)/gm,
    severity: "high",
    description: "UID extracted from object but not deleted — UID resurrection / re-wrapping bypass.",
    recommendation: "Always call `object::delete(uid)` when destroying objects; never re-wrap extracted UIDs.",
    category: "object_ownership",
  },
  {
    id: "ML-OBJ-008",
    type: "ast",
    severity: "high",
    description: "Function reads owner identity from a shared/frozen object — any user can supply it.",
    recommendation: "Derive authority strictly from owned capabilities or ctx.sender(), not from shared/frozen objects.",
    category: "object_ownership",
  },
  {
    id: "ML-OBJ-009",
    type: "regex",
    pattern: /derived_object::claim|transfer::public_receive/gm,
    severity: "medium",
    description: "Derived-object ID prediction or pre-claim squatting via deterministic address.",
    recommendation: "Restrict derived address creation to admin capabilities; verify address has no pre-existing balance.",
    category: "object_ownership",
  },
  {
    id: "ML-OBJ-010",
    type: "regex",
    pattern: /transfer::(?:public_)?receive\s*\((?!.*(?:assert!.*sender|AdminCap))/gm,
    severity: "high",
    description: "public_receive from shared object without caller permission check — anyone can claim incoming assets.",
    recommendation: "Require capability or assert `tx_context::sender(ctx) == pool.owner` before receiving.",
    category: "object_ownership",
  },
  {
    id: "ML-OBJ-011",
    type: "regex",
    pattern: /object::delete\s*\(\s*\w+\s*\)(?!.*dynamic_field::remove)/gm,
    severity: "high",
    description: "object::delete called without first removing dynamic fields — child values permanently orphaned.",
    recommendation: "Remove all dynamic fields with `dynamic_field::remove` before calling `object::delete`.",
    category: "object_ownership",
  },
  {
    id: "ML-OBJ-012",
    type: "ast",
    severity: "medium",
    description: "TransferPolicy missing kiosk_lock_rule and personal_kiosk_rule — KioskOwnerCap royalty bypass.",
    recommendation: "Enforce `kiosk_lock_rule` and `personal_kiosk_rule` in TransferPolicy to prevent cap transfers.",
    category: "object_ownership",
  },
  {
    id: "ML-OBJ-013",
    type: "regex",
    pattern: /list_with_purchase_cap\s*\(.*\n.*transfer::public_transfer/gm,
    severity: "medium",
    description: "PurchaseCap transferred externally instead of consumed atomically — NFT permanently locks if cap lost.",
    recommendation: "Use PurchaseCap only in atomic PTBs where it is guaranteed to be consumed or returned.",
    category: "object_ownership",
  },
];

// ──────────────────────────────────────────────────────────────
// SECTOR: Integer Overflow & Bitwise Arithmetic  (ML-INT-001 … ML-INT-006)
// ──────────────────────────────────────────────────────────────

const INT_RULES: Rule[] = [
  {
    id: "ML-INT-001",
    type: "regex",
    pattern: /0xffffffffffffffff\s*<<\s*192|u256[^;]*<<\s*64(?!.*checked_shl)/gm,
    severity: "critical",
    description: "Bitwise shift with wrong overflow mask — Cetus class ($223M loss May 2025).",
    recommendation: "Replace `0xffffffffffffffff << N` mask with `1u256 << N`. Use `n >= mask` not `n > mask`.",
    category: "integer_overflow",
  },
  {
    id: "ML-INT-002",
    type: "regex",
    pattern: /\bu256\b[^;]*<<\s*\d+(?!.*(?:assert!|checked_shl))/gm,
    severity: "high",
    description: "u256 left-shift with no preceding overflow guard — Move bitwise ops do not abort on overflow.",
    recommendation: "Assert `val < (1u256 << (256 - N))` before every `val << N`.",
    category: "integer_overflow",
  },
  {
    id: "ML-INT-003",
    type: "regex",
    pattern: /0xffffffffffffffff\s*<<\s*\d+/gm,
    severity: "critical",
    description: "Multi-bit mask for boundary check — incorrect bit-width for u256 context.",
    recommendation: "Compute maximum valid input explicitly and assert against it; document expected bit ranges.",
    category: "integer_overflow",
  },
  {
    id: "ML-INT-004",
    type: "regex",
    pattern: /[^;]+[/%]\s*\w+(?!.*assert!\s*\(\s*\w+\s*!=\s*0)/gm,
    severity: "medium",
    description: "Division/modulo with no preceding assert(denominator != 0).",
    recommendation: "Add `assert!(denominator != 0, EDivisionByZero);` before every dynamic division.",
    category: "integer_overflow",
  },
  {
    id: "ML-INT-005",
    type: "regex",
    pattern: /let\s+\w+\s*:\s*u64\s*=\s*\(?\w+\s*\*\s*\w+\)?\s*\//gm,
    severity: "high",
    description: "u64 * u64 result stored in u64 before division — intermediate overflow truncates high bits.",
    recommendation: "Upcast to u128 or u256 before multiplication: `let r: u128 = (a as u128) * (b as u128) / (c as u128)`.",
    category: "integer_overflow",
  },
  {
    id: "ML-INT-006",
    type: "regex",
    // Require an explicit upcast from u128/u256 before the narrowing cast — that's the real truncation risk.
    // `as u64` on a u64 or literal is not a truncation; only downcast from wider types matters.
    pattern: /\bu(?:128|256)\b[^;\n]*\bas\s+u(?:64|32|16|8)\b/gm,
    severity: "high",
    description: "Narrowing cast from u128/u256 to a smaller type — intermediate high bits silently truncated.",
    recommendation: "Assert value fits before casting: `assert!(value <= (MAX_U64 as u128), EOverflow);`.",
    category: "integer_overflow",
  },
];

// ──────────────────────────────────────────────────────────────
// SECTOR: Arithmetic Precision Loss  (ML-ARI-001 … ML-ARI-007)
// ──────────────────────────────────────────────────────────────

const ARI_RULES: Rule[] = [
  {
    id: "ML-ARI-001",
    type: "regex",
    pattern: /\(\s*\w+\s*\/\s*\w+\s*\)\s*\*\s*\w+/gm,
    severity: "high",
    description: "Division before multiplication — (a/b)*c truncates before multiplying, causing precision loss.",
    recommendation: "Reorder to (a * c) / b. Use u128/u256 intermediate. Consider fixed-point mul_div(a, c, b).",
    category: "arithmetic_precision",
  },
  {
    id: "ML-ARI-002",
    type: "regex",
    pattern: /(?:PRECISION|SCALE|FACTOR)\s*[=:]\s*1_?0{3,7}(?!_?0{3})\b/gm,
    severity: "medium",
    description: "Fixed-point scale factor < 1e9 — insufficient precision for DeFi rate/price calculations.",
    recommendation: "Use at minimum 1e9 (1_000_000_000) precision; 1e18 for high-value AMM pools.",
    category: "arithmetic_precision",
  },
  {
    id: "ML-ARI-003",
    type: "ast",
    severity: "medium",
    description: "Both protocol and user amounts use same truncating integer division — systematic value extraction.",
    recommendation: "Protocol amounts: round UP (`div_up`). User amounts: round DOWN (`div_down`).",
    category: "arithmetic_precision",
  },
  {
    id: "ML-ARI-004",
    type: "ast",
    severity: "medium",
    description: "Price/exchange rate from integer division stored to struct field, later used as multiplier — drift accumulates.",
    recommendation: "Store numerator and denominator separately; compute ratio only at point of use.",
    category: "arithmetic_precision",
  },
  {
    id: "ML-ARI-005",
    type: "regex",
    pattern: /[^;]*<<[^;]*(?:balance|liquidity|price|amount|reserve)/gm,
    severity: "high",
    description: "Bitwise shift on financial variable with no overflow check — Move bitwise ops are unchecked.",
    recommendation: "Add explicit bounds assertion before shifts on balance/price/liquidity values.",
    category: "arithmetic_precision",
  },
  {
    id: "ML-ARI-006",
    type: "regex",
    pattern: /\*\s*\w*[Ff]ee\w*\s*\/\s*1(?:0{2,4})\b(?!.*assert!.*>\s*0)/gm,
    severity: "medium",
    description: "Fee calculation rounds to zero for small amounts — dust attack evades fees.",
    recommendation: "Enforce minimum fee: `assert!(fee > 0 || size == 0, EFeeIsZero);` or use ceiling division.",
    category: "arithmetic_precision",
  },
  {
    id: "ML-ARI-007",
    type: "regex",
    pattern: /\*\s*10\s*\^\s*\([^)]*decimals[^)]*\)(?!.*(?:assert!.*!=\s*0|u256))/gm,
    severity: "high",
    description: "Cross-chain decimal conversion without overflow guard or u256 intermediate.",
    recommendation: "Use wide intermediate (u256), assert converted amount > 0, add reconciliation checks.",
    category: "arithmetic_precision",
  },
];

// ──────────────────────────────────────────────────────────────
// SECTOR: Hot Potato / Flash Loan Misuse  (ML-HOT-001 … ML-HOT-004)
// ──────────────────────────────────────────────────────────────

const HOT_RULES: Rule[] = [
  {
    id: "ML-HOT-001",
    type: "regex",
    pattern: /struct\s+\w*(?:[Rr]eceipt|[Pp]otato|[Ll]oan|[Bb]orrow|[Ff]lash)\w*\s+has\s+[^{]*\b(?:drop|copy)\b/gm,
    severity: "critical",
    description: "Hot potato struct (Receipt/Loan/Flash) has `drop` or `copy` — lifecycle guarantee broken.",
    recommendation: "Define flash loan receipts with NO abilities: `struct FlashReceipt { pool_id: ID, amount: u64 }`.",
    category: "hot_potato",
  },
  {
    id: "ML-HOT-002",
    type: "regex",
    // Match repay/finish functions that accept a Receipt/Loan-type parameter — the cross-pool check must be in the body
    // which cannot be validated by single-line regex. Flag for manual review instead of false-positive critical.
    pattern: /fun\s+\w*(?:repay|return_loan|finish_loan|finish)\w*[^(]*\([^)]*(?:Receipt|FlashLoan|Potato|Loan|Borrow)[^)]*\)/gm,
    severity: "high",
    description: "Repayment function accepts a receipt/loan struct — verify receipt.pool_id == object::id(pool) to prevent cross-pool drain.",
    recommendation: "Store source ID in receipt at creation; assert on repay: `assert!(receipt.pool_id == object::id(pool), EMismatch)`.",
    category: "hot_potato",
  },
  {
    id: "ML-HOT-003",
    type: "ast",
    severity: "high",
    description: "Flash loan module and price oracle both imported — oracle called within loan context, spot price manipulable.",
    recommendation: "Use TWAP oracles for financial decisions. Add pool-ratio deviation check if spot price required.",
    category: "hot_potato",
  },
  {
    id: "ML-HOT-004",
    type: "regex",
    pattern: /fun\s+\w+[^{]*\{(?!.*(?:flash_loan_active|assert!.*!.*active)).*(?:swap|borrow|stake)\s*\(/gm,
    severity: "high",
    description: "Swap/borrow/stake callable during active flash loan — reentrancy-equivalent via hot potato sequencing.",
    recommendation: "Add `flash_loan_active: bool` field; assert `!pool.flash_loan_active` in all pool-mutating functions.",
    category: "hot_potato",
  },
];

// ──────────────────────────────────────────────────────────────
// SECTOR: Unsafe Upgrade Patterns  (ML-UPG-001 … ML-UPG-004)
// ──────────────────────────────────────────────────────────────

const UPG_RULES: Rule[] = [
  {
    id: "ML-UPG-001",
    type: "regex",
    pattern: /fun\s+\w+[^(]*\([^)]*UpgradeCap[^)]*\)(?!.*package::upgrade_package)/gm,
    severity: "critical",
    description: "UpgradeCap accepted as auth proof without validating package ID — Pawtato exploit class.",
    recommendation: "Call `package::upgrade_package(&cap)` and assert returned ID == @expected_package.",
    category: "unsafe_upgrade",
  },
  {
    id: "ML-UPG-002",
    type: "ast",
    severity: "high",
    description: "Package upgrade adds new struct fields without a migrate() function — init not re-run on upgrade.",
    recommendation: "Define explicit `migrate(admin_cap: &AdminCap, ...)` with migration guard sentinel.",
    category: "unsafe_upgrade",
  },
  {
    id: "ML-UPG-003",
    type: "skip_mvp",
    severity: "high",
    description: "Old package version still callable — can violate new-version invariants. (SKIP_MVP)",
    recommendation: "Add version gating: `assert!(pool.version == CURRENT_VERSION, EVersionMismatch)`.",
    category: "unsafe_upgrade",
  },
  {
    id: "ML-UPG-004",
    type: "regex",
    pattern: /UpgradeCap(?!.*(?:TimelockPolicy|DayOfWeekPolicy|multisig|timelock))/gm,
    severity: "medium",
    description: "UpgradeCap held without timelock/multisig policy — single compromised key can push malicious upgrade.",
    recommendation: "Wrap UpgradeCap in a TimelockPolicy or multisig upgrade policy object.",
    category: "unsafe_upgrade",
  },
];

// ──────────────────────────────────────────────────────────────
// SECTOR: Race Conditions / Transaction Ordering  (ML-RAC-001 … ML-RAC-003)
// ──────────────────────────────────────────────────────────────

const RAC_RULES: Rule[] = [
  {
    id: "ML-RAC-001",
    type: "skip_mvp",
    severity: "medium",
    description: "Shared object front-running via validator ordering — first-mover advantage exploitable. (SKIP_MVP)",
    recommendation: "Use commit-reveal schemes or slippage tolerance: `assert!(actual >= min_expected, ESlippage)`.",
    category: "race_condition",
  },
  {
    id: "ML-RAC-002",
    type: "ast",
    severity: "medium",
    description: "TOCTOU — shared field read and validated, then used without re-reading (stale value).",
    recommendation: "Re-read value from object at point of use, not only at point of check.",
    category: "race_condition",
  },
  {
    id: "ML-RAC-003",
    type: "skip_mvp",
    severity: "low",
    description: "Shared object contention DoS — attacker floods exclusive-access transactions. (SKIP_MVP)",
    recommendation: "Minimize shared state; use per-user owned sub-objects; implement cooldowns.",
    category: "race_condition",
  },
];

// ──────────────────────────────────────────────────────────────
// SECTOR: Unchecked Return Values  (ML-RET-001 … ML-RET-004)
// ──────────────────────────────────────────────────────────────

const RET_RULES: Rule[] = [
  {
    id: "ML-RET-001",
    type: "regex",
    pattern: /let\s+_\s*=\s*coin::(?:split|from_balance)|_\s*=\s*balance::split/gm,
    severity: "critical",
    description: "Coin/Balance return value discarded with _ — permanent loss of funds.",
    recommendation: "Always bind returned coin: `let remainder = coin::split(&mut c, amount, ctx);` then transfer.",
    category: "unchecked_return",
  },
  {
    id: "ML-RET-002",
    type: "regex",
    pattern: /let\s+\(\s*_\s*,\s*(?:[^)]+)\)\s*=\s*\w+\s*\(/gm,
    severity: "high",
    description: "First tuple element (status/bool) discarded with _ — error code swallowed.",
    recommendation: "Never discard first element of tuple from arithmetic/financial helpers; assert ok flag.",
    category: "unchecked_return",
  },
  {
    id: "ML-RET-003",
    type: "regex",
    pattern: /(?:option::unwrap_or|\.unwrap\(\))(?!.*assert!)/gm,
    severity: "medium",
    description: "option::unwrap_or or .unwrap() used without preceding is_some check — potential runtime abort.",
    recommendation: "Use `assert!(result.is_some(), EOperationFailed)` before unwrapping Option returns.",
    category: "unchecked_return",
  },
  {
    id: "ML-RET-004",
    type: "regex",
    pattern: /let\s+\(\s*_\s*,\s*(?:_\s*,\s*)?\w+\)\s*=\s*\w*(?:div|mul|math)\w*\s*\(/gm,
    severity: "high",
    description: "Error/overflow flag discarded from math helper — zeroed result used as if valid.",
    recommendation: "Destructure fully and assert: `let (overflow, result) = safe_op(a, b); assert!(!overflow, EOverflow);`.",
    category: "unchecked_return",
  },
];

// ──────────────────────────────────────────────────────────────
// SECTOR: Token / Coin Management  (ML-TOK-001 … ML-TOK-008)
// ──────────────────────────────────────────────────────────────

const TOK_RULES: Rule[] = [
  {
    id: "ML-TOK-001",
    type: "regex",
    pattern: /coin::split\s*\(&mut\s+\w+,\s*\w+(?!.*assert!.*(?:>=|value))/gm,
    severity: "high",
    description: "coin::split without validating amount against coin balance — dust attack or accounting error.",
    recommendation: "Assert `amount > 0 && amount <= coin::value(&coin)` before splitting.",
    category: "token_management",
  },
  {
    id: "ML-TOK-002",
    type: "regex",
    pattern: /transfer::(?:public_)?share_object\s*\(\s*\w*[Tt]reasury[Cc]ap\w*|public\s+fun\s+\w+[^(]*\(&mut\s+TreasuryCap/gm,
    severity: "critical",
    description: "TreasuryCap shared or accessible via public function — unlimited token minting by anyone.",
    recommendation: "Keep TreasuryCap as owned object in controlled address or wrap in AdminCap-gated minter.",
    category: "token_management",
  },
  {
    id: "ML-TOK-003",
    type: "ast",
    severity: "high",
    description: "Struct has Coin<T>/Balance<T> field; destroy function exists without extracting the coin first.",
    recommendation: "In destroy functions, extract and transfer the coin before destroying the wrapper.",
    category: "token_management",
  },
  {
    id: "ML-TOK-004",
    type: "regex",
    pattern: /fun\s+\w+[^(]*\([^)]*Coin<[^>]+>[^)]*\)(?!.*(?:assert!.*==\s*price|coin::split.*change))/gm,
    severity: "high",
    description: "Function accepts Coin<T> without validating exact payment or returning change.",
    recommendation: "Assert exact payment `coin::value(&p) == price` OR split and return change to sender.",
    category: "token_management",
  },
  {
    id: "ML-TOK-005",
    type: "regex",
    pattern: /coin::create_currency(?![\s\S]*transfer::public_freeze_object)/gm,
    severity: "medium",
    description: "CoinMetadata not frozen after create_currency — mutable metadata risks post-deploy manipulation.",
    recommendation: "Immediately freeze: `transfer::public_freeze_object(metadata);` after create_currency.",
    category: "token_management",
  },
  {
    id: "ML-TOK-006",
    type: "regex",
    pattern: /shares\s*=\s*\w+\s*\*\s*total_shares\s*\/\s*total_assets(?!.*(?:virtual|offset|minimum))/gm,
    severity: "high",
    description: "Vault first-depositor share inflation — deposit * total_shares / total_assets without virtual offset.",
    recommendation: "Seed dead shares at deployment, use virtual offset, or enforce minimum shares on deposit.",
    category: "token_management",
  },
  {
    id: "ML-TOK-007",
    type: "regex",
    pattern: /fun\s+\w*(?:deposit|add)_fee\w*[^(]*\([^)]*partner[^)]*\)(?!.*(?:assert!.*sender|AdminCap))/gm,
    severity: "medium",
    description: "Fee deposit function allows arbitrary partner address without caller verification.",
    recommendation: "Assert `tx_context::sender(ctx) == partner_address` or require registry-verified partner cap.",
    category: "token_management",
  },
  {
    id: "ML-TOK-008",
    type: "regex",
    pattern: /coin::(?:deposit|transfer)\s*\([^)]*\)(?!.*is_account_registered)/gm,
    severity: "medium",
    description: "Coin transfer without is_account_registered check — aborts if recipient CoinStore unregistered.",
    recommendation: "Check registration before transfer: `if (!coin::is_account_registered<T>(addr)) { coin::register<T>(addr); }`.",
    category: "token_management",
  },
];

// ──────────────────────────────────────────────────────────────
// SECTOR: Object Wrapping / Unwrapping  (ML-WRP-001 … ML-WRP-003)
// ──────────────────────────────────────────────────────────────

const WRP_RULES: Rule[] = [
  {
    id: "ML-WRP-001",
    type: "regex",
    pattern: /transfer::(?:public_)?freeze_object\s*\(\s*\w+\s*\)(?!.*\.inner\s*=)/gm,
    severity: "high",
    description: "freeze_object on a wrapper containing key-ability inner objects — inner objects permanently locked.",
    recommendation: "Extract all key-ability inner objects before freezing: `let inner = wrapper.inner; transfer::public_transfer(inner, ctx.sender());`.",
    category: "object_wrapping",
  },
  {
    id: "ML-WRP-002",
    type: "ast",
    severity: "high",
    description: "Outer struct has key-ability inner field but no function returns/transfers that inner — permanent lock.",
    recommendation: "Always define an unwrap function for every wrap function with appropriate access control.",
    category: "object_wrapping",
  },
  {
    id: "ML-WRP-003",
    type: "ast",
    severity: "medium",
    description: "Struct field type has `key` ability but lacks `store` — cannot be stored in parent object field.",
    recommendation: "Add `store` ability to inner type if wrapping is intended: `struct Inner has key, store { ... }`.",
    category: "object_wrapping",
  },
];

// ──────────────────────────────────────────────────────────────
// SECTOR: Denial of Service  (ML-DOS-001 … ML-DOS-004)
// ──────────────────────────────────────────────────────────────

const DOS_RULES: Rule[] = [
  {
    id: "ML-DOS-001",
    type: "regex",
    // Removed broken same-line negative lookahead (MAX_SIZE check is in the body, not after the opening brace).
    // Now only flags iteration over user-controlled inputs by looking for common unbounded-growth patterns.
    pattern: /vector::for_each(?:_ref|_mut)?\s*\(\s*&(?:mut\s+)?\w*(?:user|input|entries|items|list)\w*/gm,
    severity: "medium",
    description: "Iterating over a user-supplied collection — gas cost grows with input size, potential DoS.",
    recommendation: "Cap collection size before iterating: `assert!(vector::length(&col) < MAX_SIZE, EFull)`. Process in batches.",
    category: "denial_of_service",
  },
  {
    id: "ML-DOS-002",
    type: "skip_mvp",
    severity: "medium",
    description: "Shared object starvation — attacker floods consensus queue to block legitimate users. (SKIP_MVP)",
    recommendation: "Minimize shared state; use per-user owned objects; implement per-user cooldowns.",
    category: "denial_of_service",
  },
  {
    id: "ML-DOS-003",
    type: "skip_mvp",
    severity: "low",
    description: "Resource exhaustion via repeated object creation — unbounded on-chain object accumulation. (SKIP_MVP)",
    recommendation: "Charge storage deposit per object; enforce per-user creation limit; provide delete path.",
    category: "denial_of_service",
  },
  {
    id: "ML-DOS-004",
    type: "regex",
    pattern: /table::add\s*\(&mut\s+\w+,\s*(?:ctx\.sender\(\)|sender|\w+_address)(?!.*(?:contains|borrow_mut))/gm,
    severity: "medium",
    description: "table::add on user-controlled recurring key without contains check — duplicate key aborts forever.",
    recommendation: "Use upsert or check: `if (table::contains(t, key)) { *table::borrow_mut(t, key) = val; } else { table::add(t, key, val); }`.",
    category: "denial_of_service",
  },
];

// ──────────────────────────────────────────────────────────────
// SECTOR: External Module / Dependency Security  (ML-EXT-001 … ML-EXT-004)
// ──────────────────────────────────────────────────────────────

const EXT_RULES: Rule[] = [
  {
    id: "ML-EXT-001",
    type: "regex",
    pattern: /use\s+(?!sui::|std::)\w+::\w+(?!.*(?:Move\.lock|pinned|rev\s*=))/gm,
    severity: "high",
    description: "Third-party library imported without pinned version in Move.lock — Cetus integer-mate class.",
    recommendation: "Audit math library dependencies line-by-line. Pin versions in Move.lock. Fuzz at boundary values.",
    category: "dependency_security",
  },
  {
    id: "ML-EXT-002",
    type: "regex",
    pattern: /git\s*=\s*"[^"]+"[^}]*branch\s*=/gm,
    severity: "medium",
    description: "Dependency pinned to git branch instead of commit hash — auto-picks up unreviewed upstream changes.",
    recommendation: "Pin all dependencies to specific commit hashes or published package addresses in Move.toml.",
    category: "dependency_security",
  },
  {
    id: "ML-EXT-003",
    type: "skip_mvp",
    severity: "medium",
    description: "Cross-module invariant violation via stale object version from upgraded dependency. (SKIP_MVP)",
    recommendation: "Implement version gating: `assert!(obj.version == CURRENT_VERSION, EStaleVersion)`.",
    category: "dependency_security",
  },
  {
    id: "ML-EXT-004",
    type: "regex",
    pattern: /friend\s+\w+::\w+(?!.*same_package)/gm,
    severity: "medium",
    description: "Cross-package friend declaration — orphaned or replaced friend module gains privileged access.",
    recommendation: "Prefer `public(package)` for intra-package access; use capability-passing for cross-package trust.",
    category: "dependency_security",
  },
];

// ──────────────────────────────────────────────────────────────
// SECTOR: Design Logic Flaws  (ML-LOG-001 … ML-LOG-020)
// ──────────────────────────────────────────────────────────────

const LOG_RULES: Rule[] = [
  {
    id: "ML-LOG-001",
    type: "regex",
    pattern: /fun\s+\w+[^{]*\{(?!.*assert!.*(?:status|state)\s*==).*(?:status|state)\s*=/gm,
    severity: "high",
    description: "State transition function does not assert required prior state — invalid state machine transitions.",
    recommendation: "Every state-transition must assert: `assert!(obj.status == EXPECTED_PRIOR_STATE, EInvalidTransition)`.",
    category: "design_logic",
  },
  {
    id: "ML-LOG-002",
    type: "ast",
    severity: "medium",
    description: "Multi-step operation modifies invariant fields with asserts interleaved — partial update risk.",
    recommendation: "Apply checks-effects: all asserts first, all mutations after, no asserts between mutations.",
    category: "design_logic",
  },
  {
    id: "ML-LOG-003",
    type: "ast",
    severity: "medium",
    description: "Generic type parameter with user-supplied types enables callback/drop reentrancy-equivalent.",
    recommendation: "Use phantom type parameters when T is for type safety only; avoid destructing user-supplied T.",
    category: "design_logic",
  },
  {
    id: "ML-LOG-004",
    type: "regex",
    pattern: /(?:expires_at|deadline|expiry|end_time)\s*(?:!=|<|>|==)\s*clock::timestamp_ms(?!.*_ms\b)/gm,
    severity: "high",
    description: "Time unit confusion — timestamp compared to clock::timestamp_ms but may be stored in seconds.",
    recommendation: "Suffix all timestamp vars `_ms`. Assert `expires_at_ms > 1_000_000_000_000` (looks like ms not s).",
    category: "design_logic",
  },
  {
    id: "ML-LOG-005",
    type: "skip_mvp",
    severity: "medium",
    description: "Cross-function PTB invariant violation — two individually safe functions unsafe in sequence. (SKIP_MVP)",
    recommendation: "Document pre/post conditions; add entry-condition assertions to sensitive functions.",
    category: "design_logic",
  },
  {
    id: "ML-LOG-006",
    type: "regex",
    pattern: /package::claim\s*<[^>]+>\s*\([^)]+\)(?!.*ctx\.sender\(\)).*transfer::/gm,
    severity: "high",
    description: "One-time witness Publisher claimed and transferred to non-deployer address without admin check.",
    recommendation: "Always transfer Publisher to ctx.sender() in init; never expose Publisher creation to public callers.",
    category: "design_logic",
  },
  {
    id: "ML-LOG-007",
    type: "regex",
    pattern: /let\s+(\w+)\s*=\s*&mut\s+\w+\.\w+;[^;]*\n[^;]*\1\s*=\s*\w+;(?!.*\*\1\s*=)/gm,
    severity: "critical",
    description: "Pointer reassignment bug — `left = limit` reassigns pointer instead of `*left = *limit` (Lombard Finance class).",
    recommendation: "Use dereference operator on both sides: `*left = *limit;` not `left = limit;`.",
    category: "design_logic",
  },
  {
    id: "ML-LOG-008",
    type: "regex",
    // Narrowed to only flag when the uint param is named like an index/id (common in asset-registry exploits).
    // The original body lookahead was single-line and fired on every generic fn with a uint param.
    pattern: /fun\s+\w+<[A-Z]\w*>[^(]*\([^)]*(?:index|asset_id|token_id|coin_id|market_id)\s*:\s*u(?:64|8|32|16|128|256)[^)]*\)/gm,
    severity: "high",
    description: "Generic function with index/id parameter and no type_name validation — Navi Protocol asset theft class.",
    recommendation: "Validate `assert!(type_name::get<T>() == config.coin_type, ETypeMismatch);` before using the index to look up assets.",
    category: "design_logic",
  },
  {
    id: "ML-LOG-009",
    type: "regex",
    pattern: /fun\s+\w+[^(]*\(\s*\w+\s*:\s*&\w+\s*,\s*\w+\s*:\s*&\w+[^)]*\)(?!.*assert!.*pool_id\s*==\s*object::id)/gm,
    severity: "high",
    description: "Two paired objects accepted without binding check — position liquidated against wrong pool.",
    recommendation: "Store associated pool ID in position at creation; assert on use: `assert!(pos.pool_id == object::id(pool), EPoolMismatch)`.",
    category: "design_logic",
  },
  {
    id: "ML-LOG-010",
    type: "regex",
    pattern: /option::borrow\s*\(&\s*\w+\s*\)(?!.*option::is_some).*option::extract/gm,
    severity: "medium",
    description: "option::borrow called after option::extract on same Option — guaranteed runtime abort.",
    recommendation: "Extract the value once; reuse local variable, or borrow before extracting.",
    category: "design_logic",
  },
  {
    id: "ML-LOG-011",
    type: "regex",
    pattern: /(?:random::new_generator|RandomGenerator)[^;]*;.*if\s*\([^)]*rand[^)]*\)(?!.*gas_equal)/gm,
    severity: "critical",
    description: "Randomness branch with outcome-dependent gas — attacker sets gas budget to abort losing paths.",
    recommendation: "Make all outcome branches gas-equal, or store random result and execute effects in next tx.",
    category: "design_logic",
  },
  {
    id: "ML-LOG-012",
    type: "regex",
    pattern: /public\s+fun\s+\w+[^(]*\([^)]*(?:Random|RandomGenerator)[^)]*\)/gm,
    severity: "high",
    description: "Randomness-consuming function declared public — attackers compose in PTB to abort losing outcomes.",
    recommendation: "Declare randomness-consuming functions as `entry` to block PTB composition.",
    category: "design_logic",
  },
  {
    id: "ML-LOG-013",
    type: "regex",
    pattern: /fun\s+\w+[^(]*\([^)]*RandomGenerator[^)]*\)/gm,
    severity: "high",
    description: "RandomGenerator passed as argument — internal state predictable to caller via serialization.",
    recommendation: "Pass only `&Random`; construct RandomGenerator locally: `random::new_generator(&rand, ctx)`.",
    category: "design_logic",
  },
  {
    id: "ML-LOG-014",
    type: "regex",
    pattern: /fun\s+\w*(?:swap|add_liquidity|trade)\w*[^{]*\{(?!.*assert!.*!.*paused)/gm,
    severity: "medium",
    description: "Swap/liquidity function missing pool-pause state check — trading continues during emergency halt.",
    recommendation: "Assert at start of trade functions: `assert!(!pool.paused, EPoolPaused);`.",
    category: "design_logic",
  },
  {
    id: "ML-LOG-015",
    type: "ast",
    severity: "medium",
    description: "event::emit with attacker-controlled fields, or state-changing function lacks event::emit.",
    recommendation: "Enforce caller checks before emitting events; ensure every state mutation emits an event.",
    category: "design_logic",
  },
  {
    id: "ML-LOG-016",
    type: "regex",
    pattern: /struct\s+\w*[Ee]vent\w*\s+has\s+[^{]*\b(?:store|key)\b/gm,
    severity: "low",
    description: "Event struct declares redundant `store` or `key` ability — only `copy + drop` needed.",
    recommendation: "Restrict event structs to `has copy, drop` abilities only.",
    category: "design_logic",
  },
  {
    id: "ML-LOG-017",
    type: "regex",
    pattern: /fun\s+\w+[^{]*\{(?!.*assert!.*!.*in_progress).*(?:in_progress|operation_active)\s*=/gm,
    severity: "high",
    description: "Re-invokable atomic initiator — start function can be called twice in same PTB, resetting snapshot.",
    recommendation: "Assert `!vault.operation_in_progress` at function start before setting the flag.",
    category: "design_logic",
  },
  {
    id: "ML-LOG-018",
    type: "regex",
    pattern: /(?:email|name|phone)\s*[,)][^;]*(?:address|salt|seed)/gm,
    severity: "high",
    description: "zkLogin address derived from mutable OIDC claim (email/name/phone) — account takeover on reassignment.",
    recommendation: "Use only the provider-stable `sub` claim as zkLogin address derivation anchor.",
    category: "design_logic",
  },
  {
    id: "ML-LOG-019",
    type: "skip_mvp",
    severity: "high",
    description: "Missing JWT binding or OIDC field validation in zkLogin relying party — JWT replay attack. (SKIP_MVP)",
    recommendation: "Bind nonce to ephemeral public key; validate `iss` and `aud` fields; check epoch expiry.",
    category: "design_logic",
  },
  {
    id: "ML-LOG-020",
    type: "regex",
    pattern: /(?:voting_power|vote_weight|governance_weight)\s*=\s*(?:balance|coin::value|token_balance)\s*\(/gm,
    severity: "high",
    description: "Governance weight from current token balance — flash loan inflates balance for instant governance control.",
    recommendation: "Use historical epoch snapshots or locked stakes for voting power; never use current active balance.",
    category: "design_logic",
  },
];

// ──────────────────────────────────────────────────────────────
// Assemble and export
// ──────────────────────────────────────────────────────────────

export const RULES: readonly Rule[] = [
  ...ACC_RULES,
  ...OBJ_RULES,
  ...INT_RULES,
  ...ARI_RULES,
  ...HOT_RULES,
  ...UPG_RULES,
  ...RAC_RULES,
  ...RET_RULES,
  ...TOK_RULES,
  ...WRP_RULES,
  ...DOS_RULES,
  ...EXT_RULES,
  ...LOG_RULES,
];

/** Map from rule ID → Rule for O(1) lookup by layer1.ts */
export const RULE_REGISTRY: ReadonlyMap<string, Rule> = new Map(
  RULES.map((r) => [r.id, r])
);

// ──────────────────────────────────────────────────────────────
// Integrity check at module load — fail loudly if counts diverge
// ──────────────────────────────────────────────────────────────

(function validateRegistry() {
  const expected = RULE_COUNT; // 93
  if (RULES.length !== expected) {
    throw new Error(
      `[rules.ts] Rule count mismatch: expected ${expected}, got ${RULES.length}`
    );
  }

  const regexCount = RULES.filter((r) => r.type === "regex").length;
  const astCount = RULES.filter((r) => r.type === "ast").length;
  const skipCount = RULES.filter((r) => r.type === "skip_mvp").length;

  if (regexCount !== 65 || astCount !== 19 || skipCount !== 9) {
    throw new Error(
      `[rules.ts] Type count mismatch: regex=${regexCount}/65, ast=${astCount}/19, skip=${skipCount}/9`
    );
  }

  for (const rule of RULES) {
    if (!VALID_RULE_IDS.has(rule.id)) {
      throw new Error(`[rules.ts] Rule ${rule.id} not found in VALID_RULE_IDS — add it to rule-ids.ts`);
    }
    if (rule.type === "regex" && !rule.pattern) {
      throw new Error(`[rules.ts] REGEX rule ${rule.id} missing pattern`);
    }
  }
})();
