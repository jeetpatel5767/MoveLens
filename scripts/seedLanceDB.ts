/**
 * scripts/seedLanceDB.ts
 * Run once to populate lancedb_store/ with known-vulnerable Move snippets.
 * Uses the Layer 4 Python sidecar /embed-raw endpoint to generate 768-dim Jina vectors.
 *
 * Usage: npx tsx scripts/seedLanceDB.ts
 *
 * Prereqs:
 *   - python scripts/layer4_server.py must be running on port 8765
 *   - pip install flask sentence-transformers lancedb must be done
 */

import * as lancedb from "@lancedb/lancedb";
import { env } from "../src/lib/env";

const SIDECAR = env.LAYER4_SIDECAR_URL ?? "http://localhost:8765";
const DB_PATH = "./lancedb_store";

// ──────────────────────────────────────────────────────────────
// Known-vulnerable Move snippets corpus
// Each entry: name (unique slug), sector, severity, code
// ──────────────────────────────────────────────────────────────

interface CorpusEntry {
  name:     string;
  sector:   string;
  severity: string;
  code:     string;
}

const CORPUS: CorpusEntry[] = [
  // ── Integer Overflow / Bitwise (Cetus class) ──────────────────────────────
  {
    name:     "cetus_checked_shlw",
    sector:   "ML-INT",
    severity: "critical",
    code: `
// Cetus CLMM checked_shlw vulnerability — wrong overflow mask before bit-shift
public fun checked_shlw(n: u128): u128 {
    let mask: u128 = 0xffffffffffffffff;  // Should be 0xffffffffffffffffffffffffffffffff
    if (n > mask) abort EOutOfRange;
    let result = n << 64;  // overflows because mask is 64-bit not 128-bit
    result
}`,
  },
  {
    name:     "integer_overflow_bitshift_1",
    sector:   "ML-INT",
    severity: "critical",
    code: `
// Unsafe left shift without overflow check
public fun compute_price(amount: u64, multiplier: u64): u64 {
    let result = amount << 32;  // no overflow guard
    result * multiplier
}`,
  },
  {
    name:     "integer_overflow_u128_cast",
    sector:   "ML-INT",
    severity: "critical",
    code: `
// Unsafe cast from u64 to u128 before multiplication — intermediate overflow
public fun calculate_lp(a: u64, b: u64): u128 {
    let result: u128 = (a as u128) * (b as u128);
    let mask = 0xffffffffffffffff;  // wrong mask — should cover u128 range
    if (result > mask) abort 1;
    result
}`,
  },
  {
    name:     "integer_overflow_shr_mask",
    sector:   "ML-INT",
    severity: "critical",
    code: `
// Incorrect right-shift mask check
fun checked_shrw(n: u128): u64 {
    let mask: u64 = 0xffffffff;  // 32-bit mask for 64-bit shift
    if ((n >> 64) > (mask as u128)) abort EOverflow;
    ((n >> 64) as u64)
}`,
  },
  {
    name:     "integer_overflow_fee_calc",
    sector:   "ML-INT",
    severity: "high",
    code: `
// Fee calculation with potential overflow
public fun compute_fee(amount: u64, fee_bps: u64): u64 {
    // amount * fee_bps can overflow u64 for large amounts
    let fee = amount * fee_bps / 10000;
    fee
}`,
  },
  {
    name:     "cetus_sqrt_price_overflow",
    sector:   "ML-INT",
    severity: "critical",
    code: `
// sqrt_price_x96 multiplication overflow — same class as Cetus exploit
public fun compute_amount_from_price(sqrt_price: u128, liquidity: u128): u64 {
    let result = sqrt_price * liquidity;  // can overflow u128
    let shifted = result >> 96;
    (shifted as u64)
}`,
  },

  // ── Access Control / Capability forgery (Pawtato class) ──────────────────
  {
    name:     "pawtato_admin_cap_forgery",
    sector:   "ML-ACC",
    severity: "critical",
    code: `
// Pawtato: AdminCap minted without validating UpgradeCap package ID
public fun create_admin_cap(upgrade_cap: &UpgradeCap, to: address, ctx: &mut TxContext) {
    // BUG: no check that upgrade_cap belongs to this package!
    let cap = AdminCap { id: object::new(ctx) };
    transfer::transfer(cap, to);
}`,
  },
  {
    name:     "admin_cap_no_sender_check",
    sector:   "ML-ACC",
    severity: "critical",
    code: `
// Public entry function that mints authority object with no guard
public entry fun mint_admin(ctx: &mut TxContext) {
    let cap = AdminCap { id: object::new(ctx) };
    transfer::transfer(cap, ctx.sender());
    // Anyone can call this and get admin access
}`,
  },
  {
    name:     "public_fun_no_capability",
    sector:   "ML-ACC",
    severity: "critical",
    code: `
// High-value operation exposed without capability check
public fun drain_treasury(vault: &mut Vault, amount: u64, to: address, ctx: &mut TxContext) {
    let coin = coin::take(&mut vault.balance, amount, ctx);
    transfer::public_transfer(coin, to);
}`,
  },
  {
    name:     "access_control_hardcoded_address",
    sector:   "ML-ACC",
    severity: "medium",
    code: `
// Hardcoded admin address — brittle and not key-rotatable
public fun admin_only(ctx: &TxContext) {
    assert!(ctx.sender() == @0xADMIN1234, ENotAdmin);
    // proceed with privileged operation
}`,
  },
  {
    name:     "capability_generic_unconstrained",
    sector:   "ML-ACC",
    severity: "critical",
    code: `
// Generic capability without type constraint — phantom substitution possible
struct Cap<T> has key, store {
    id: UID,
    phantom: std::marker::PhantomData<T>,
}
public fun use_cap<T>(cap: &Cap<T>) {
    // T is unconstrained — attacker can substitute any type
}`,
  },
  {
    name:     "public_package_no_cap_check",
    sector:   "ML-ACC",
    severity: "high",
    code: `
// public(package) used as security boundary without capability check
public(package) fun withdraw(pool: &mut Pool, amount: u64, ctx: &mut TxContext): Coin<SUI> {
    coin::take(&mut pool.balance, amount, ctx)
    // No AdminCap check — any module in same package can drain
}`,
  },
  {
    name:     "missing_signer_check",
    sector:   "ML-ACC",
    severity: "critical",
    code: `
// Entry function modifies shared state — no signer validation
public entry fun update_config(
    config: &mut Config,
    new_fee: u64,
    // Missing: _: &AdminCap
) {
    config.fee_bps = new_fee;
}`,
  },

  // ── Hot Potato / Flash Loan ────────────────────────────────────────────────
  {
    name:     "hot_potato_no_consume",
    sector:   "ML-HOT",
    severity: "high",
    code: `
// Hot potato struct — no abilities, MUST be consumed in same tx
struct FlashLoan {
    amount: u64,
    repay_to: address,
}
// BUG: function creates FlashLoan but doesn't enforce consumption
public fun borrow(pool: &mut Pool, amount: u64, ctx: &TxContext): (Coin<SUI>, FlashLoan) {
    let coin = coin::take(&mut pool.balance, amount, ctx);
    (coin, FlashLoan { amount, repay_to: ctx.sender() })
}`,
  },
  {
    name:     "hot_potato_dropped",
    sector:   "ML-HOT",
    severity: "critical",
    code: `
// Flash loan receipt can be dropped — loan not enforced
struct Receipt {
    loan_amount: u64,
}
public fun borrow_and_forget(pool: &mut Pool, amount: u64, ctx: &mut TxContext): Coin<SUI> {
    let coin = coin::take(&mut pool.balance, amount, ctx);
    // Receipt is constructed then immediately dropped — no repayment enforced
    let _receipt = Receipt { loan_amount: amount };
    coin
}`,
  },
  {
    name:     "hot_potato_has_drop",
    sector:   "ML-HOT",
    severity: "high",
    code: `
// Loan receipt accidentally has 'drop' ability — flash loan trivially exploitable
struct LoanReceipt has drop {
    amount: u64,
    pool_id: ID,
}
public fun flash_borrow(pool: &mut Pool, amount: u64, ctx: &mut TxContext): (Coin<SUI>, LoanReceipt) {
    let coin = coin::take(&mut pool.balance, amount, ctx);
    (coin, LoanReceipt { amount, pool_id: object::id(pool) })
}`,
  },

  // ── Object Ownership ──────────────────────────────────────────────────────
  {
    name:     "object_ownership_no_assert",
    sector:   "ML-OWN",
    severity: "high",
    code: `
// Transfer without verifying object owner
public fun transfer_nft(nft: NFT, to: address) {
    // No ctx.sender() check — anyone who has the NFT object can transfer it
    transfer::public_transfer(nft, to);
}`,
  },
  {
    name:     "shared_object_no_authority",
    sector:   "ML-OWN",
    severity: "critical",
    code: `
// Shared object mutation without authority check
public fun update_shared_pool(pool: &mut Pool, new_fee: u64) {
    // Pool is shared — but no capability required
    pool.fee_bps = new_fee;
}`,
  },
  {
    name:     "object_id_mismatch",
    sector:   "ML-OWN",
    severity: "high",
    code: `
// Object passed by reference but not validated against stored ID
public fun withdraw_from_vault(vault: &mut Vault, cap: &VaultCap, amount: u64, ctx: &mut TxContext): Coin<SUI> {
    // Missing: assert!(object::id(vault) == cap.vault_id, EMismatch);
    coin::take(&mut vault.balance, amount, ctx)
}`,
  },

  // ── Arithmetic Precision Loss ─────────────────────────────────────────────
  {
    name:     "arithmetic_div_before_mul",
    sector:   "ML-ARI",
    severity: "high",
    code: `
// Division before multiplication loses precision
public fun compute_yield(principal: u64, rate_bps: u64, periods: u64): u64 {
    let per_period = principal / periods;  // BUG: truncates first
    per_period * rate_bps / 10000
}`,
  },
  {
    name:     "arithmetic_truncation_loss",
    sector:   "ML-ARI",
    severity: "medium",
    code: `
// Significant precision loss in fixed-point arithmetic
const PRECISION: u64 = 1_000_000;
public fun compute_price_ratio(a: u64, b: u64): u64 {
    // Should scale up before dividing: (a * PRECISION) / b
    a / b * PRECISION  // loses all fractional bits
}`,
  },
  {
    name:     "arithmetic_u64_overflow_in_reward",
    sector:   "ML-ARI",
    severity: "high",
    code: `
// Reward calculation overflows for large stake amounts
public fun calculate_rewards(stake: u64, rate: u64, elapsed: u64): u64 {
    // stake * rate * elapsed can overflow u64 without u128 intermediate
    stake * rate * elapsed / 1_000_000
}`,
  },

  // ── Unsafe Upgrade Patterns ───────────────────────────────────────────────
  {
    name:     "upgrade_cap_no_package_check",
    sector:   "ML-UPG",
    severity: "high",
    code: `
// UpgradeCap transferred without package ID validation
public fun delegate_upgrade(cap: UpgradeCap, to: address) {
    // Missing: assert!(package::from_package<PackageModule>(&cap), EWrongPackage);
    transfer::public_transfer(cap, to);
}`,
  },
  {
    name:     "upgrade_make_immutable_lost",
    sector:   "ML-UPG",
    severity: "medium",
    code: `
// UpgradeCap stored in a shared object — can be accessed without authorization
public fun store_upgrade_cap(registry: &mut Registry, cap: UpgradeCap) {
    // Storing in a shared/dynamic field exposes it to all callers
    dynamic_field::add(&mut registry.id, b"upgrade_cap", cap);
}`,
  },

  // ── Race Conditions ───────────────────────────────────────────────────────
  {
    name:     "race_condition_epoch_price",
    sector:   "ML-RAC",
    severity: "medium",
    code: `
// Price oracle read without freshness check — can use stale price
public fun get_safe_price(oracle: &Oracle, clock: &Clock): u64 {
    // BUG: no check that oracle.last_updated is within acceptable range
    oracle.price
}`,
  },
  {
    name:     "race_condition_toctou",
    sector:   "ML-RAC",
    severity: "high",
    code: `
// Check-then-act on shared state — TOCTOU vulnerability
public fun safe_withdraw(vault: &mut Vault, amount: u64, ctx: &mut TxContext): Coin<SUI> {
    let balance = coin::value(&vault.reserve);
    assert!(balance >= amount, EInsufficientFunds);
    // Another tx could drain between check and take
    coin::take(&mut vault.balance, amount, ctx)
}`,
  },

  // ── Unchecked Return Values ───────────────────────────────────────────────
  {
    name:     "unchecked_return_option",
    sector:   "ML-RET",
    severity: "medium",
    code: `
// Option return value discarded without checking
public fun maybe_withdraw(vault: &mut Vault, amount: u64): Option<Coin<SUI>> {
    let result = try_take(&mut vault.balance, amount);
    result  // Caller might discard with let _ = ...
}

public entry fun withdraw_unsafe(vault: &mut Vault, amount: u64, ctx: &mut TxContext) {
    let _ = maybe_withdraw(vault, amount);  // silently ignoring the result
}`,
  },
  {
    name:     "unchecked_vector_pop",
    sector:   "ML-RET",
    severity: "medium",
    code: `
// Vector operation result unchecked
public fun remove_item(items: &mut vector<u64>, idx: u64): u64 {
    vector::swap_remove(items, idx)
    // If idx is out of bounds, Move aborts — but no descriptive error
}`,
  },

  // ── Token / Coin Management ───────────────────────────────────────────────
  {
    name:     "token_double_spend",
    sector:   "ML-TOK",
    severity: "critical",
    code: `
// Balance withdrawn then checked — double-spend window
public fun claim_reward(vault: &mut Vault, user: address, ctx: &mut TxContext): Coin<SUI> {
    let reward = vault.pending_rewards[user];
    let coin = coin::take(&mut vault.balance, reward, ctx);
    // BUG: pending_rewards[user] not zeroed before transfer
    transfer::public_transfer(coin, user);
    coin::zero(ctx)
}`,
  },
  {
    name:     "token_fee_on_transfer_bypass",
    sector:   "ML-TOK",
    severity: "high",
    code: `
// Fee calculation missing on certain transfer paths
public fun transfer_with_fee(
    token: &mut Token,
    amount: u64,
    bypass_fee: bool,
    ctx: &mut TxContext
): Coin<SUI> {
    if (bypass_fee) {
        // Bypass flag allows fee-free transfer
        coin::take(&mut token.balance, amount, ctx)
    } else {
        let fee = amount * token.fee_bps / 10000;
        coin::take(&mut token.balance, amount - fee, ctx)
    }
}`,
  },
  {
    name:     "token_mint_no_cap",
    sector:   "ML-TOK",
    severity: "critical",
    code: `
// Token minting without TreasuryCap
public fun unlimited_mint(supply: &mut Supply<TOKEN>, amount: u64, ctx: &mut TxContext): Coin<TOKEN> {
    // Supply mutation without checking TreasuryCap or cap limits
    let balance = balance::increase_supply(supply, amount);
    coin::from_balance(balance, ctx)
}`,
  },

  // ── Object Wrapping ───────────────────────────────────────────────────────
  {
    name:     "object_wrapping_lost",
    sector:   "ML-WRP",
    severity: "high",
    code: `
// Object wrapped into another — original can never be unwrapped if wrapper lost
public fun wrap_nft(nft: NFT, wrapper: &mut Wrapper, _ctx: &TxContext) {
    // Wrapping is irreversible if wrapper is made shared or transferred away
    wrapper.locked_nft = option::some(nft);
    // No unwrap function provided — NFT permanently locked
}`,
  },

  // ── Denial of Service ─────────────────────────────────────────────────────
  {
    name:     "dos_unbounded_loop",
    sector:   "ML-DOS",
    severity: "high",
    code: `
// Loop bounded only by vector length — gas exhaustion DoS
public entry fun process_all_orders(orders: &mut vector<Order>, ctx: &mut TxContext) {
    let i = 0;
    while (i < vector::length(orders)) {
        let order = vector::borrow_mut(orders, i);
        process_order(order, ctx);
        i = i + 1;
    }
    // No upper bound on loop iterations
}`,
  },
  {
    name:     "dos_recursion",
    sector:   "ML-DOS",
    severity: "high",
    code: `
// Recursive call without depth bound — potential stack overflow / gas exhaustion
public fun traverse_tree(node: &Node, depth: u64): u64 {
    if (option::is_none(&node.children)) return 0;
    // No max_depth check
    let sum = 0u64;
    let i = 0;
    while (i < vector::length(option::borrow(&node.children))) {
        sum = sum + traverse_tree(vector::borrow(option::borrow(&node.children), i), depth + 1);
        i = i + 1;
    };
    sum
}`,
  },

  // ── Dependency Security ───────────────────────────────────────────────────
  {
    name:     "dependency_mutable_import",
    sector:   "ML-DEP",
    severity: "medium",
    code: `
// Module imports a dependency with 'use ... as mut' — allows mutation of external state
module my_protocol::vault {
    use 0x2::coin::{Self, Coin};
    use 0x2::transfer;
    // Package uses address-based imports — pinning not enforced
    use external_protocol::risky_module;
}`,
  },

  // ── Design Logic ─────────────────────────────────────────────────────────
  {
    name:     "design_logic_missing_event",
    sector:   "ML-LOG",
    severity: "low",
    code: `
// Critical state change with no event emission — off-chain indexers blind
public fun update_treasury_address(treasury: &mut Treasury, new_addr: address, _: &AdminCap) {
    treasury.recipient = new_addr;
    // Missing: event::emit(TreasuryUpdated { old: ..., new: new_addr });
}`,
  },
  {
    name:     "design_logic_no_pause",
    sector:   "ML-LOG",
    severity: "medium",
    code: `
// Protocol has no pause mechanism — cannot halt in emergency
module emergency_protocol::pool {
    public entry fun deposit(pool: &mut Pool, coin: Coin<SUI>, ctx: &mut TxContext) {
        // No paused: bool check
        let balance = coin::into_balance(coin);
        balance::join(&mut pool.reserve, balance);
    }
}`,
  },
  {
    name:     "design_logic_reentrancy",
    sector:   "ML-LOG",
    severity: "high",
    code: `
// State update after external call — reentrancy pattern
public fun withdraw_and_notify(
    vault: &mut Vault,
    amount: u64,
    callback: address,
    ctx: &mut TxContext
): Coin<SUI> {
    let coin = coin::take(&mut vault.balance, amount, ctx);
    // External call before state update
    transfer::public_transfer(coin, callback);
    vault.total_withdrawn = vault.total_withdrawn + amount;  // state updated after
    coin::zero(ctx)
}`,
  },
  {
    name:     "design_logic_frontrun_price",
    sector:   "ML-LOG",
    severity: "high",
    code: `
// Price commitment without reveal — front-runnable
public fun set_price(registry: &mut Registry, price: u64, ctx: &TxContext) {
    // No commit-reveal scheme, no time lock
    registry.price = price;
}`,
  },
  {
    name:     "design_logic_zero_value_check",
    sector:   "ML-LOG",
    severity: "medium",
    code: `
// Missing zero-value guard on critical parameter
public fun stake(pool: &mut Pool, amount: u64, ctx: &mut TxContext) {
    // No assert!(amount > 0, EZeroAmount) guard
    let shares = amount * pool.share_price / 1_000_000;
    pool.total_staked = pool.total_staked + amount;
    pool.shares[ctx.sender()] = shares;
}`,
  },

  // ── More Integer Overflow variants ────────────────────────────────────────
  {
    name:     "integer_overflow_swap_math",
    sector:   "ML-INT",
    severity: "critical",
    code: `
// AMM swap calculation without overflow protection
public fun compute_swap_output(amount_in: u64, reserve_in: u64, reserve_out: u64): u64 {
    let amount_in_with_fee = amount_in * 997;  // can overflow without u128 cast
    let numerator = amount_in_with_fee * reserve_out;
    let denominator = reserve_in * 1000 + amount_in_with_fee;
    numerator / denominator
}`,
  },
  {
    name:     "integer_overflow_liquidity_math",
    sector:   "ML-INT",
    severity: "critical",
    code: `
// Liquidity token computation susceptible to manipulation via overflow
public fun mint_lp_tokens(amount_a: u64, amount_b: u64, total_supply: u64): u64 {
    // sqrt(amount_a * amount_b) — intermediate product can overflow u64
    let product = amount_a * amount_b;
    math::sqrt(product)
}`,
  },
  {
    name:     "integer_wrapping_subtraction",
    sector:   "ML-INT",
    severity: "high",
    code: `
// Unsigned subtraction without underflow check — wraps to max value
public fun deduct_fee(balance: u64, fee: u64): u64 {
    // If fee > balance, result wraps to u64::MAX
    balance - fee
}`,
  },

  // ── More Access Control ───────────────────────────────────────────────────
  {
    name:     "access_admin_stored_in_dynamic_field",
    sector:   "ML-ACC",
    severity: "high",
    code: `
// AdminCap stored in dynamic field — can be extracted by any caller with object ID
public fun store_admin_cap(registry: &mut Registry, cap: AdminCap) {
    dynamic_field::add(&mut registry.id, b"admin", cap);
}
public fun retrieve_admin_cap(registry: &mut Registry): AdminCap {
    dynamic_field::remove(&mut registry.id, b"admin")
    // No authorization check!
}`,
  },
  {
    name:     "access_two_party_no_verify",
    sector:   "ML-ACC",
    severity: "critical",
    code: `
// Multi-sig style check bypassed — only one party verified
public fun two_party_action(
    cap_a: &PartyACap,
    cap_b: &PartyBCap,
    target: &mut SharedResource
) {
    // cap_a is verified but cap_b binding to target not checked
    assert!(cap_a.target_id == object::id(target), EWrongTarget);
    // Missing: assert!(cap_b.target_id == object::id(target), EWrongTarget);
    target.value = target.value + 1;
}`,
  },

  // ── More Token / Coin ─────────────────────────────────────────────────────
  {
    name:     "token_split_truncation",
    sector:   "ML-TOK",
    severity: "medium",
    code: `
// Coin split loses remainder — funds permanently locked
public fun split_equal(coin: Coin<SUI>, n: u64, ctx: &mut TxContext): vector<Coin<SUI>> {
    let total = coin::value(&coin);
    let each = total / n;  // remainder = total % n is dropped
    let parts = vector::empty();
    let i = 0;
    let remaining = coin;
    while (i < n - 1) {
        let part = coin::split(&mut remaining, each, ctx);
        vector::push_back(&mut parts, part);
        i = i + 1;
    };
    vector::push_back(&mut parts, remaining);
    parts
}`,
  },

  // ── More Upgrade ─────────────────────────────────────────────────────────
  {
    name:     "upgrade_policy_not_locked",
    sector:   "ML-UPG",
    severity: "medium",
    code: `
// Upgrade policy can be changed by anyone — no cap check
public entry fun set_upgrade_policy(
    cap: &mut UpgradeCap,
    policy: u8,
    ctx: &TxContext
) {
    // ctx.sender() not checked against cap owner
    package::only_additive_upgrades(cap);  // can be overridden
}`,
  },

  // ── More Hot Potato ───────────────────────────────────────────────────────
  {
    name:     "hot_potato_borrow_no_return",
    sector:   "ML-HOT",
    severity: "critical",
    code: `
// Borrow receipt allows collateral to be taken without repayment
struct BorrowReceipt {
    collateral_value: u64,
    // No 'has' abilities — should force consumption
    // But: if wrapped in Option<BorrowReceipt>, can be dropped
}`,
  },

  // ── More Race Condition ───────────────────────────────────────────────────
  {
    name:     "race_condition_oracle_stale",
    sector:   "ML-RAC",
    severity: "high",
    code: `
// Oracle price used without staleness check — attacker can use stale price
public fun liquidate(
    position: &mut Position,
    oracle: &PriceOracle,
    clock: &Clock
) {
    let price = oracle.last_price;
    // No check: assert!(clock::timestamp_ms(clock) - oracle.updated_at < MAX_STALENESS, EStalePrice);
    let value = position.size * price;
    if (value < position.min_collateral) {
        close_position(position);
    }
}`,
  },

  // ── More Design Logic ─────────────────────────────────────────────────────
  {
    name:     "design_logic_integer_division_order",
    sector:   "ML-LOG",
    severity: "medium",
    code: `
// Rounding direction not specified — can favor attacker in AMM
public fun get_amount_out(amount_in: u64, fee_bps: u64): u64 {
    // Round down benefits the protocol but may be inconsistent
    let fee = amount_in * fee_bps / 10000;
    amount_in - fee
    // Should explicitly document and test rounding direction
}`,
  },
  {
    name:     "design_logic_init_not_called",
    sector:   "ML-LOG",
    severity: "high",
    code: `
// Module init sets critical state — if not called, protocol in undefined state
module my_protocol::config {
    struct Config has key {
        id: UID,
        initialized: bool,
    }
    // init() not defined — Config never created, all functions will abort
    public fun get_config(): &Config {
        // borrow_global<Config>(@my_protocol) would abort
        abort 0
    }
}`,
  },
  {
    name:     "design_logic_approve_and_execute",
    sector:   "ML-LOG",
    severity: "high",
    code: `
// Governance: same address can propose and execute — no separation of duties
public fun propose_and_execute(
    dao: &mut DAO,
    proposal: Proposal,
    cap: &AdminCap,
    ctx: &TxContext
) {
    // Single party creates and immediately executes — no voting period enforced
    let id = vector::length(&dao.proposals);
    vector::push_back(&mut dao.proposals, proposal);
    execute_proposal(dao, id, cap, ctx);
}`,
  },
];

// ──────────────────────────────────────────────────────────────
// Sidecar /embed-raw helper
// ──────────────────────────────────────────────────────────────

async function embedRaw(code: string): Promise<number[]> {
  const resp = await fetch(`${SIDECAR}/embed-raw`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`/embed-raw returned ${resp.status}: ${txt}`);
  }
  const data = await resp.json() as { vector?: number[]; error?: string };
  if (!data.vector || !Array.isArray(data.vector)) {
    throw new Error(`/embed-raw bad response: ${JSON.stringify(data)}`);
  }
  return data.vector;
}

// ──────────────────────────────────────────────────────────────
// Wait for sidecar to finish loading models
// ──────────────────────────────────────────────────────────────

async function waitForSidecar(maxMs = 120_000): Promise<void> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${SIDECAR}/health`, { signal: AbortSignal.timeout(3000) });
      const body = await r.json() as { status: string; models_loaded: boolean };
      if (body.status === "ok" && body.models_loaded) {
        console.log("[seed] Sidecar ready — models loaded.");
        return;
      }
      console.log("[seed] Sidecar up but models still loading... waiting 5s");
    } catch {
      console.log("[seed] Sidecar not yet reachable... waiting 5s");
    }
    await new Promise<void>((r) => setTimeout(r, 5_000));
  }
  throw new Error(`Sidecar did not become ready within ${maxMs / 1000}s`);
}

// ──────────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────────

async function main() {
  console.log(`[seed] Seeding LanceDB corpus (${CORPUS.length} snippets) → ${DB_PATH}`);
  console.log(`[seed] Sidecar URL: ${SIDECAR}`);

  // Wait for sidecar models to be ready (Jina download takes ~1-2 minutes first time)
  await waitForSidecar(180_000);

  // Connect to LanceDB
  const db = await lancedb.connect(DB_PATH);
  console.log("[seed] LanceDB connected.");

  // Build rows with embeddings
  const rows: Array<{
    name:     string;
    sector:   string;
    severity: string;
    code:     string;
    vector:   number[];
  }> = [];

  let i = 0;
  for (const entry of CORPUS) {
    i++;
    const pct = Math.round((i / CORPUS.length) * 100);
    process.stdout.write(`\r[seed] Embedding ${i}/${CORPUS.length} (${pct}%)  `);
    try {
      const vector = await embedRaw(entry.code.trim());
      rows.push({
        name:     entry.name,
        sector:   entry.sector,
        severity: entry.severity,
        code:     entry.code.trim().slice(0, 512),  // truncate to 512 chars for storage
        vector,
      });
    } catch (err) {
      console.error(`\n[seed] WARN: failed to embed ${entry.name}: ${err}`);
    }
  }

  console.log(`\n[seed] Got ${rows.length} embeddings — writing to LanceDB table 'vuln_corpus'...`);

  // Create/overwrite table
  const table = await db.createTable("vuln_corpus", rows, { mode: "overwrite" });
  console.log(`[seed] Table 'vuln_corpus' created with ${await table.countRows()} rows.`);

  // Verify: query with Cetus snippet and confirm high similarity
  console.log("[seed] Verifying Cetus similarity search...");
  const cetusSnippet = `
let mask: u128 = 0xffffffffffffffff;
if (n > mask) abort EOutOfRange;
let result = n << 64;
  `.trim();

  const cetusVec = await embedRaw(cetusSnippet);
  const results = await table.search(cetusVec).limit(3).toArray();
  console.log("[seed] Top-3 similarity results for Cetus snippet:");
  for (const r of results) {
    // L2 distance → cosine similarity (unit vectors): sim = 1 - dist^2/2
    const dist = r._distance as number;
    const sim = Math.max(0, 1 - (dist * dist) / 2);
    console.log(`  name=${r.name}  dist=${dist.toFixed(4)}  sim=${sim.toFixed(4)}`);
    if (r.name === "cetus_checked_shlw" || r.name?.startsWith("cetus") || r.name?.startsWith("integer_overflow")) {
      if (sim > 0.75) {
        console.log(`  ✓ Cetus-class snippet found with similarity ${sim.toFixed(4)} > 0.75`);
      }
    }
  }

  console.log("\n[seed] ✓ LanceDB corpus seeded successfully.");
  console.log(`[seed] lancedb_store/ path: ${DB_PATH}`);
}

main().catch((err) => {
  console.error("[seed] Fatal error:", err);
  process.exit(1);
});
