// FIXTURE: vulnerable_cap.move
// Expected findings: ML-ACC-008, ML-UPG-001
// Flaw: any UpgradeCap is accepted and consumed without calling package::upgrade_package,
// allowing an attacker to permanently freeze an upgrade ticket without a real upgrade.

module movelens_test::vulnerable_cap {
    use sui::package::{Self, UpgradeCap};
    use sui::tx_context::TxContext;
    use sui::transfer;
    use sui::object::{Self, UID};

    /// Admin capability minted in exchange for an upgrade cap.
    struct AdminCap has key { id: UID }

    /// VULNERABLE: accepts any UpgradeCap without package::upgrade_package validation.
    /// The caller can pass a UpgradeCap from *any* package and drain it here, which
    /// either burns a legitimate upgrade token or gives admin rights to the wrong package.
    public fun create_admin_cap(
        upgrade_cap: UpgradeCap,
        recipient: address,
        ctx: &mut TxContext,
    ) {
        let cap = AdminCap { id: object::new(ctx) };
        transfer::public_transfer(cap, recipient);
        // make_immutable consumes the UpgradeCap — no upgrade_package call ever made
        package::make_immutable(upgrade_cap);
    }
}
