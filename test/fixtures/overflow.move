// FIXTURE: overflow.move
// Expected findings: ML-INT-001, ML-INT-002, ML-INT-003
// Flaw: Cetus-class bitwise shift overflow patterns.
//   • ML-INT-003 — raw 0xffffffffffffffff << N (64-bit constant shifted)
//   • ML-INT-001 — 0xffffffffffffffff << 192 (exact Cetus mask) + u256 << 64
//   • ML-INT-002 — u256 variable shifted by numeric literal without assert/checked_shl

module movelens_test::overflow {

    /// VULNERABLE: Cetus-class mask — 0xffffffffffffffff shifted left 192 bits.
    /// ML-INT-001 fires (0xffffffffffffffff << 192 pattern).
    /// ML-INT-003 fires (0xffffffffffffffff << any N pattern).
    public fun compute_mask(): u256 {
        let mask: u256 = 0xffffffffffffffff << 192;
        mask
    }

    /// VULNERABLE: u256 shifted by a literal with no overflow guard.
    /// ML-INT-001 fires (u256 ... << 64 without checked_shl).
    /// ML-INT-002 fires (\bu256\b ... << \d+ without assert!/checked_shl).
    public fun unsafe_shift(value: u256): u256 {
        let result: u256 = value << 64;
        result
    }
}
