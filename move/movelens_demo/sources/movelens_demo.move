/// MoveLens demo module — intentional audit target for Sui Overflow 2026.
/// This is the on-chain component of the MoveLens security auditor demo.
/// The MoveLens engine audits this very module during the judging demo.
///
/// NOTE: This module contains deliberately introduced patterns that
/// MoveLens's audit engine (Layer 1 + Layer 2) is designed to detect.
/// It is NOT intended for production use.
module movelens_demo::vault {
    use sui::coin::{Self, Coin};
    use sui::balance::{Self, Balance};
    use sui::sui::SUI;
    use sui::object::{Self, UID};
    use sui::transfer;
    use sui::tx_context::{Self, TxContext};
    use sui::event;

    // ── Structs ──────────────────────────────────────────────────────────────

    /// Shared vault holding SUI deposits.
    public struct Vault has key {
        id: UID,
        balance: Balance<SUI>,
        owner: address,
        total_deposited: u64,
        fee_bps: u64,
    }

    /// Admin capability — holder can change fee_bps and drain emergency funds.
    public struct AdminCap has key, store {
        id: UID,
    }

    // ── Events ───────────────────────────────────────────────────────────────

    public struct DepositEvent has copy, drop {
        vault_id: address,
        depositor: address,
        amount: u64,
    }

    public struct WithdrawEvent has copy, drop {
        vault_id: address,
        recipient: address,
        amount: u64,
    }

    // ── Init ─────────────────────────────────────────────────────────────────

    fun init(ctx: &mut TxContext) {
        let admin_cap = AdminCap { id: object::new(ctx) };
        transfer::transfer(admin_cap, tx_context::sender(ctx));
    }

    // ── Public entry points ───────────────────────────────────────────────────

    /// Create a new vault. Anyone can create one.
    public entry fun create_vault(fee_bps: u64, ctx: &mut TxContext) {
        let vault = Vault {
            id: object::new(ctx),
            balance: balance::zero(),
            owner: tx_context::sender(ctx),
            total_deposited: 0,
            fee_bps,
        };
        transfer::share_object(vault);
    }

    /// Deposit SUI into the vault.
    public entry fun deposit(vault: &mut Vault, coin: Coin<SUI>, ctx: &mut TxContext) {
        let amount = coin::value(&coin);
        // AUDIT TARGET: integer overflow — total_deposited could wrap on large deposits
        vault.total_deposited = vault.total_deposited + amount;
        balance::join(&mut vault.balance, coin::into_balance(coin));
        event::emit(DepositEvent {
            vault_id: object::id_address(vault),
            depositor: tx_context::sender(ctx),
            amount,
        });
    }

    /// Withdraw from the vault. Only the vault owner can withdraw.
    public entry fun withdraw(vault: &mut Vault, amount: u64, ctx: &mut TxContext) {
        // AUDIT TARGET: missing signer check — uses vault.owner but no abort on mismatch?
        assert!(tx_context::sender(ctx) == vault.owner, 1);
        let fee = calculate_fee(amount, vault.fee_bps);
        let net = amount - fee;
        let withdrawn = coin::from_balance(balance::split(&mut vault.balance, net), ctx);
        transfer::public_transfer(withdrawn, tx_context::sender(ctx));
        event::emit(WithdrawEvent {
            vault_id: object::id_address(vault),
            recipient: tx_context::sender(ctx),
            amount: net,
        });
    }

    /// Emergency drain — admin only.
    public entry fun emergency_drain(
        _admin: &AdminCap,
        vault: &mut Vault,
        recipient: address,
        ctx: &mut TxContext,
    ) {
        let total = balance::value(&vault.balance);
        if (total > 0) {
            let all = coin::from_balance(
                balance::split(&mut vault.balance, total),
                ctx,
            );
            transfer::public_transfer(all, recipient);
        }
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    /// Calculate fee. AUDIT TARGET: potential division/arithmetic issues if fee_bps > 10000.
    fun calculate_fee(amount: u64, fee_bps: u64): u64 {
        (amount * fee_bps) / 10000
    }

    // ── View functions ───────────────────────────────────────────────────────

    public fun vault_balance(vault: &Vault): u64 {
        balance::value(&vault.balance)
    }

    public fun vault_owner(vault: &Vault): address {
        vault.owner
    }
}
