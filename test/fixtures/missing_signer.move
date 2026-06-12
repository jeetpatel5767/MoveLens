// FIXTURE: missing_signer.move
// Expected findings: ML-ACC-001
// Flaw: public entry function updates a sensitive config field with no
// AdminCap, OwnerCap, or ctx.sender() guard — anyone can call it.

module movelens_test::missing_signer {
    use sui::object::{Self, UID};

    /// Protocol configuration stored on-chain.
    struct ProtocolConfig has key {
        id: UID,
        fee_rate: u64,
        treasury: address,
    }

    /// VULNERABLE: public fun with no capability or sender check.
    /// Any account can raise or lower the protocol fee without restriction.
    public fun update_fee(config: &mut ProtocolConfig, new_fee: u64) {
        config.fee_rate = new_fee;
    }

    /// VULNERABLE: same flaw — treasury can be redirected by anyone.
    public fun set_treasury(config: &mut ProtocolConfig, new_treasury: address) {
        config.treasury = new_treasury;
    }
}
