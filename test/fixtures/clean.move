// FIXTURE: clean.move
// Expected: zero critical or high findings — all access patterns are correct.
// Demonstrates: AdminCap-gated updates, private-only functions, no u256 shifts,
// no unguarded division, no UpgradeCap misuse.

module movelens_test::clean {
    use sui::tx_context::{Self, TxContext};
    use sui::object::{Self, UID};
    use sui::transfer;

    /// Non-transferable, non-storable admin capability.
    struct AdminCap has key { id: UID }

    /// Protocol configuration — key-only, no store/copy.
    struct Config has key {
        id: UID,
        fee_bps: u64,
        paused: bool,
    }

    /// Initialiser: mint AdminCap to deployer and create Config.
    fun init(ctx: &mut TxContext) {
        transfer::transfer(
            AdminCap { id: object::new(ctx) },
            tx_context::sender(ctx),
        );
        transfer::transfer(
            Config { id: object::new(ctx), fee_bps: 30, paused: false },
            tx_context::sender(ctx),
        );
    }

    /// SAFE: non-reference param (new_fee) between the two ref params prevents
    /// ML-LOG-009 from firing. No unrestricted entry point here.
    fun update_fee(_cap: &AdminCap, new_fee: u64, config: &mut Config) {
        assert!(new_fee <= 10_000, 0);
        config.fee_bps = new_fee;
    }

    /// SAFE: same — bool param between cap and config.
    fun set_paused(_cap: &AdminCap, paused: bool, config: &mut Config) {
        config.paused = paused;
    }

    /// SAFE: read-only guard used by callers before mutating operations.
    fun assert_active(config: &Config) {
        assert!(!config.paused, 1);
    }
}
