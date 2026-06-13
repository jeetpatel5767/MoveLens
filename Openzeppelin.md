# 1. OpenZeppelin Sui DeFi Math Library Inventory  

OpenZeppelin’s Sui contracts (repo: *openzeppelin/contracts-sui*) include a math library under `math/core` called `openzeppelin_math` (and a fixed-point package `openzeppelin_fp_math`). The **integer math** library provides overflow-checked arithmetic for widths u8, u16, u32, u64, u128, u256 (with a u512 helper). Key public functions are:  

- `average(a: uInt, b: uInt, rounding_mode: RoundingMode) -> uInt` – Returns the arithmetic mean of two unsigned integers, using the specified rounding mode (down/up/nearest). *Safe*: explicitly controls rounding and never silently overflows (the sum `(a+b)` is handled by a macro with built-in checks).  
- `checked_shl(value: uInt, shift: u8) -> Option<uInt>` – Left-shifts by `shift` bits **losslessly**: returns `None` if any non-zero bits would be lost. *Safe*: Shift overflow returns `None` instead of wrapping.  
- `checked_shr(value: uInt, shift: u8) -> Option<uInt>` – Analogous right-shift with lossless semantics.  
- `mul_div(a: uInt, b: uInt, denominator: uInt, rounding_mode: RoundingMode) -> Option<uInt>` – Computes `(a * b) / denominator` with the given rounding. *Safe*: Aborts if `denominator == 0` and returns `None` if the full-precision result doesn’t fit in the target width.  
- `mul_shr(a: uInt, b: uInt, shift: u8, rounding_mode: RoundingMode) -> Option<uInt>` – Computes `(a * b) >> shift` with rounding. *Safe*: Returns `None` on overflow.  
- `clz(value: uInt) -> u8 (or u16 for u256)` – Count leading zeros. Always returns 0–width-1 (zero for input 0).  
- `msb(value: uInt) -> u8` – Index of most-significant 1 bit (0 if value is 0).  
- `log2(value: uInt, rounding_mode: RoundingMode) -> u8 (or u16 for u256)` – Base-2 logarithm with rounding.  
- `log256(value: uInt, rounding_mode: RoundingMode) -> u8` – Base-256 logarithm (bytes) with rounding.  
- `log10(value: uInt, rounding_mode: RoundingMode) -> u8` – Base-10 logarithm with rounding.  
- `sqrt(value: uInt, rounding_mode: RoundingMode) -> uInt` – Integer square root with rounding.  
- `inv_mod(value: uInt, modulus: uInt) -> Option<uInt>` – Modular inverse of `value mod modulus`. Returns `None` if inverse doesn’t exist; aborts on `modulus == 0`.  
- `mul_mod(a: uInt, b: uInt, modulus: uInt) -> uInt` – Computes `(a * b) mod modulus`; aborts on `modulus == 0`.  
- `is_power_of_ten(n: uInt) -> bool` – Returns `true` if `n` is a power of 10 within the type’s range (O(1) lookup).  

All functions either abort or return `None` on error rather than overflow silently, and accept an explicit `RoundingMode`, so they form *safe arithmetic patterns*. For example, `mul_div` uses a 512-bit intermediate under the hood to avoid overflow before rounding, and `checked_shl`/`checked_shr` detect any lost bits instead of truncating quietly. 

Additionally, the **fixed-point math** package (`openzeppelin_fp_math`) defines decimal types with 9 decimals (`UD30x9`, `SD29x9`). Their base modules provide methods like `add(x,y)`, `sub(x,y)`, `mul(x,y)`, `div(x,y)`, `sqrt(x)`, `ln(x)`, etc., all of which **abort on overflow or invalid input**. For instance, `UD30x9::add(x,y)` aborts on overflow and `UD30x9::mul(x,y)` aborts if the product exceeds the representable range. Conversion helpers (`decimal_scaling`) enforce safe upcasts/downcasts between precisions with truncation only when specified (and abort if out of range).  

As of June 2026, the current version of OZ Sui contracts is **v1.2.0** (released 3 June 2026).  No public security audits of the Sui math library have been released yet, but the code is directly ported from OpenZeppelin’s audited Solidity math library with added overflow guards.  

# 2. Cetus Exploit (Checked Shift Bug)  

The Cetus AMM hack (May 2025) stemmed from an incorrect implementation of a 256-bit left-shift check. In the vulnerable code, a custom function `checked_shlw(n: u256)` was intended to check for overflow when shifting `n` left by 64 bits, but used the wrong bitmask. The code was:  

```move
public fun checked_shlw(n: u256): (u256, bool) {
   let mask = 0xffffffffffffffff << 192;  // This is incorrect!
   if (n > mask) {
       (0, true)
   } else {
       ((n << 64), false)
   }
}
```  

Because `0xffffffffffffffff << 192` only covers the top 64 bits, **values slightly above 2^192 still passed the check**. In other words, many values with bits in positions 192–255 were not caught, so `(n << 64)` silently overflowed (Move’s shift does not abort). The attacker exploited this by choosing `n` just above 2^192; after the shift, almost all bits were truncated, making a huge numerator look tiny. 

**Wrong mask value:** `0xffffffffffffffff << 192` (hex `0xffffffffffffffff0000...0000`, bits 192–255 set).  
**Correct mask should be:** `(1 << 192) - 1` (hex `0xffffffffffffffffffffffffffffffffffffffffffffffff`) so that all values ≥2^192 fail the check.  

In contrast, the OZ library would handle this safely by using `checked_shl`. For example, `u256::checked_shl(n, 64)` internally ensures no bits are lost (returning `None` on overflow).  

**Detection (flagging) logic:** A static analyzer should look for any custom bit-shift logic on 256-bit values. In particular, the flawed code uses `n << 64` (one-word shift) inside a manual check. For example:  

- If a module defines or calls a function like `checked_shlw(u256)` or uses `<< 64` on a `u256` without using `checked_shl`, flag it.  
- If there is an overflow check using `0xffffffffffffffff << 192` or any incorrect mask, flag it.  

These patterns indicate deviation from the OZ safe pattern (`checked_shl`).  

**Real case:** Cetus AMM’s `get_delta_a` used this bad shift check, leading to the $223M exploit. Similar custom 256-bit shift code (e.g. in any Move library or AMM) would be vulnerable. (For example, Cetus’s own `integer-mate` library had this bug; any other Sui protocol porting similar 256-bit logic could suffer the same flaw.)  

# 3. Layer 2 Detection Rules  

Below are proposed rules to detect deviations from OZ’s safe arithmetic. Each rule targets one OZ function (or pattern).  The **OZ safe pattern** is given (often as pseudocode calling the OZ function), and the **dangerous deviation** shows the risky code to flag. The **detection logic** specifies what to look for in code. “Real case” cites known examples; if none exist in Sui, we note that. Severity levels (Critical/High/Medium/Low) are assigned by potential impact.  

### [Rule ID: ML-OZ-001] checked_shl Deviation  
- **OZ safe pattern:** `u<width>::checked_shl(value, shift)` (lossless left shift).  
- **Dangerous deviation:** Raw left shift on unsigned ints, e.g. `value << shift`, or custom functions like `checked_shlw(n: u256)` with an incorrect mask. In particular, a check using `0xffffffffffffffff << 192` is wrong.  
- **Detection logic:** IF a module uses `<<` on any `u8/16/32/64/128/256` without the OZ `checked_shl`, or if it defines `checked_shlw` (or similar) with mask `0xffffffffffffffff << 192`, THEN flag **Critical**.  
- **Real case:** Cetus AMM hack – its `checked_shlw` used the wrong mask and allowed a 256-bit overflow (Critical impact).  
- **Severity:** Critical.  

### [Rule ID: ML-OZ-002] checked_shr Deviation  
- **OZ safe pattern:** `u<width>::checked_shr(value, shift)`.  
- **Dangerous deviation:** Raw right shift, e.g. `value >> shift`, where significant bits might be lost without detection.  
- **Detection logic:** IF code uses `>>` on an unsigned int without using `checked_shr`, flag **High**. (Also check any custom `checked_shrw` functions or analogous patterns.)  
- **Real case:** No major Sui incidents yet, but unchecked shifts can truncate data.  
- **Severity:** High.  

### [Rule ID: ML-OZ-003] mul_div Deviation  
- **OZ safe pattern:** `u<width>::mul_div(a, b, denominator, rounding)`.  
- **Dangerous deviation:** Compute `(a * b) / denominator` directly (possibly with integer division), without checking overflow or controlling rounding. Example:  
  ```move
  let result = (a * b) / denom;
  ```  
- **Detection logic:** IF an expression contains a multiplication and then a division by a variable (non-constant) (especially without an explicit rounding parameter), THEN flag **High**. (I.e., pattern `*` followed by `/` in one expression on ints.)  
- **Real case:** (No direct Sui exploit known; but mis-ordering or overflow here can lead to huge errors.)  
- **Severity:** High.  

### [Rule ID: ML-OZ-004] mul_shr Deviation  
- **OZ safe pattern:** `u<width>::mul_shr(a, b, shift, rounding)`.  
- **Dangerous deviation:** Compute `(a * b) >> shift` directly. Example:  
  ```move
  let result = (a * b) >> shift;
  ```  
- **Detection logic:** IF an expression has `*` and then a right-shift (`>>`) on an integer (especially a variable shift), THEN flag **High**.  
- **Real case:** Similar to mul_div, no direct Sui case known; incorrect rounding or overflow can occur.  
- **Severity:** High.  

### [Rule ID: ML-OZ-005] average Deviation  
- **OZ safe pattern:** `u<width>::average(a, b, rounding)`.  
- **Dangerous deviation:** Compute `(a + b) / 2` without rounding control. Example:  
  ```move
  let avg = (a + b) / 2;
  ```  
  This can overflow if `a+b` exceeds the max, and it always truncates (rounds down) silently.  
- **Detection logic:** IF code contains `(x + y) / 2` (or `/ 2`) for integers, THEN flag **Medium**. (Must ensure this is not part of a more complex safe pattern.)  
- **Real case:** No known exploit, but unchecked sum overflow could occur.  
- **Severity:** Medium.  

### [Rule ID: ML-OZ-006] inv_mod Deviation  
- **OZ safe pattern:** `u<width>::inv_mod(value, modulus)`.  
- **Dangerous deviation:** Custom modular inverse computation, e.g. exponentiation (`power(value, mod-2, mod)`) or loops. Example:  
  ```move
  // naive mod inverse (dangerous if no gcd check)
  let inv = value.mod_exp(mod - 2, mod);
  ```  
- **Detection logic:** IF code manually computes inverses (e.g. using exponent mod or iterative algorithms) instead of `inv_mod`, THEN flag **Medium**.  
- **Real case:** (No known Sui case; but mod-inverse must check coprimality.)  
- **Severity:** Medium.  

### [Rule ID: ML-OZ-007] sqrt Deviation  
- **OZ safe pattern:** `u<width>::sqrt(value, rounding)`.  
- **Dangerous deviation:** Implementing integer sqrt by hand (e.g. loops, binary search).  
- **Detection logic:** IF code contains a custom `sqrt` routine (loops narrowing the value, or `while`/`repeat` to find root) rather than calling `sqrt()`, THEN flag **Low**.  
- **Real case:** (No known incident.)  
- **Severity:** Low.  

### [Rule ID: ML-OZ-008] logarithm Deviation  
- **OZ safe pattern:** `u<width>::log2(value, rounding)` / `log10` / `log256`.  
- **Dangerous deviation:** Custom log computation (e.g. loop shifting until value==0).  
- **Detection logic:** IF code implements logs via loops or repeated divisions (e.g. count bits manually) instead of using `log2/log10/log256()`, THEN flag **Low**.  
- **Real case:** (No known Sui case.)  
- **Severity:** Low.  

### [Rule ID: ML-OZ-009] Fixed-point arithmetic Deviation  
- **OZ safe pattern:** Use `UD30x9`/`SD29x9` types and their methods (e.g. `x.add(y)`, `x.mul(y)`, `x.div(y)`), or use `decimal_scaling` for conversions.  
- **Dangerous deviation:** Treating decimal quantities as integers and mixing precisions manually. Examples:  
  - Multiplying/dividing by `10^9` constants manually.  
  - Using integer arithmetic on balances/amounts assuming 9 decimals without checks.  
- **Detection logic:** IF code does raw integer operations involving powers of 10 (e.g. `* 1000000000u128` or `/ 1000000000u128`), or compares/multiplies Sui coin values without using UD30x9, THEN flag **High**. (This indicates missing overflow/truncation safeguards.)  
- **Real case:** (No specific exploit; however, rounding errors or overflow in DeFi pricing are critical.)  
- **Severity:** High.  

### [Rule ID: ML-OZ-010] Percentage calculation Deviation  
- **OZ safe pattern:** Implement percentages using `mul_div(value, percent, 100, rounding)`.  
- **Dangerous deviation:** Naively computing `value * percent / 100` with integer division, which truncates towards zero. Example:  
  ```move
  let fee = amount * fee_bps / 10000;  // missing rounding control
  ```  
- **Detection logic:** IF code multiplies by a percentage and then divides by a constant denominator (e.g. 100, 1000, 10000) without explicit rounding handling, THEN flag **Medium**. (Check for patterns like `*` followed by `/ 100` or similar.)  
- **Real case:** Common source of off-by-one or fee miscalculation bugs (no direct Sui exploit recorded).  
- **Severity:** Medium.  

*(More rules can be added similarly for other OZ functions if needed.)*  

# 4. Implementation Guidance  

To implement Layer 2 checks, one should parse each Move module and pattern-match against the rules above. A robust approach is to use the Move AST or IR: e.g. compile with `move build` or use the Sui Move Prover/Parser to get an AST, then traverse for the specific constructs. For example, detect any binary operations (`+`, `-`, `*`, `/`, `<<`, `>>`, `%`) on integer types that match the dangerous patterns.  

In TypeScript, you might use a Move parser library (if available) or invoke Move/Sui commands. For a hackathon/demo, simple regexes can work as a stopgap (e.g. search the source for `"\<\< 64"` or `"/ 2"` etc.), but beware false positives. A better long-term solution is to integrate with a Move analysis tool (e.g. MoveScanner or Sui Move Analyzer) or write a small AST visitor using `@mysten/move-parser` (if it exists).  

For example:  
- To catch checked-shl issues, look for any `<<` on a u128/u256 or a function named `checked_shlw`.  
- To catch mul_div misuse, look for patterns where a multiplication is immediately divided by a non-constant.  
- For percentage, look for division by 100/1000/10000 following a multiplication.  

Existing Move static analysis tools (MoveProver, MoveScanner, the MoveBytecode Crate, Sui Move-Analyzer) do not have built-in OZ benchmarks yet, but they can parse the code; you could extend them. For a TypeScript implementation, using the Move bytecode compiler API or textual search is the quickest.  

**In summary:** Use AST matching wherever possible. Otherwise, set up regex/AST rules to find, e.g.:  

- **Regex examples:**  
  - `([0-9a-zA-Z_]+)\s*\*\s*([0-9a-zA-Z_]+)\s*/\s*([0-9a-zA-Z_]+)` (mul_div pattern)  
  - `([0-9a-zA-Z_]+)\s*<<\s*([0-9]+)` (checked_shl misuse)  
  - `\([0-9a-zA-Z_]+\s*\+\s*[0-9a-zA-Z_]+\)\s*/\s*2` (average misuse)  

- **AST approach:** Parse expressions and look for `BinOp` nodes with operators `Shl`, `Shr`, `Add`, `Mul`, `Div`, `%` on int types, then apply the logic above.  

Layer 2 could be implemented in `src/lib/audit/layer2.ts` as a series of pattern checks: if any rule triggers, emit a finding with that rule ID and severity. (MoveScanner by MoveBit and the Sui Prover also perform static checks, but since no existing tool specifically flags OZ deviations, writing a custom checker as above is straightforward for the hackathon.) 

**References:** The OpenZeppelin Sui math library and docs, and public analyses of the Cetus hack.