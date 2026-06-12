# MoveLens Vulnerability Rule Corpus
**Version:** 2.0 (Classified) | **Date:** June 2026 | **Target:** Sui Move Smart Contract Static Analyzer

> Research compiled for Sui Overflow 2026 — MoveLens (Walrus Track).
> Sources: Cetus post-mortems (Halborn, Cyfrin, QuillAudits, Dedaub), SlowMist auditing primer, OZ Notorious Bug Digest #8, OpenZeppelin Sui audit findings, Trail of Bits, Monethic security workshop, Mirage Audits, MoveScanner research, Zellic, MoveBit, Mysten Labs upgrade docs.

## Implementation Classification Summary

Every rule is tagged with its implementation type:
- **⚙️ REGEX** — 65 rules — implement as TypeScript RegExp in `src/lib/audit/layer1.ts`
- **🔍 AST** — 19 rules — implement as AST visitor in `src/lib/audit/layer1.ts` (requires Move parser)
- **⏭️ SKIP_MVP** — 9 rules — too complex for hackathon, skip for now

**Priority: implement REGEX rules first. They cover all Critical-severity exploits including Cetus (ML-INT-001), Pawtato (ML-ACC-008, ML-UPG-001), and hot potato attacks (ML-HOT-001, ML-HOT-002).**

### How to implement in `layer1.ts`:
```typescript
// Each REGEX rule becomes a Rule object:
{
  id: "ML-INT-001",
  type: "regex",
  pattern: /0xffffffffffffffff\s*<<\s*192|u256[^;]*<<\s*64(?!.*checked_shl)/gs,
  severity: "critical",
  description: "Bitwise shift overflow — Cetus class",
  recommendation: "Replace mask with 1u256 << N. Use checked_shl from OZ library."
}

// Each AST rule becomes a visitor function:
function checkML_ACC_004(module: MoveModule): Finding[] {
  // Walk struct definitions looking for generic Cap types
  // Walk function signatures looking for unconstrained <R> capability params
}
```

---


> Research compiled for Sui Overflow 2026 — MoveLens (Walrus Track).
> Sources: Cetus post-mortems (Halborn, Cyfrin, QuillAudits, Dedaub), SlowMist auditing primer, OZ Notorious Bug Digest #8, OpenZeppelin Sui audit findings, Trail of Bits, Monethic security workshop, Mirage Audits, MoveScanner research, Zellic, MoveBit, Mysten Labs upgrade docs.

---

## SECTOR: Access Control & Visibility

### [Rule ID: ML-ACC-001] Public Visibility on Internal Function

> **⚙️ Implementation: `REGEX`** — Pattern: `public\s+(entry\s+)?fun\s+\w+[^{]*\{(?!.*(?:AdminCap|OwnerCap|ctx\.sender))`


- **Pattern**: Function declared `public fun` or `public entry fun` that modifies privileged state (e.g., updates balances, changes admin fields, mints tokens) with no capability parameter and no `assert!(ctx.sender() == ...)` check.
- **Real Case**: SlowMist auditing primer (2024) documents this as one of the most common critical findings across Sui protocols — functions that directly update deposit amounts or admin-guarded state accidentally exposed as `public`. Multiple unnamed DeFi protocols cited. Monethic security workshop (Jan 2026) replicated it in live audits.
- **Detection Logic**: IF function visibility is `public` or `public entry` AND function body writes to a privileged struct field (any field on an object not owned by sender) AND no `&AdminCap`, `&OwnerCap`, or equivalent capability parameter is present AND no `assert!(ctx.sender() == ...)` guard is present THEN flag as **Critical**.
- **False Positive**: View functions (`public fun get_balance(...): u64`) that only read state. Functions that are genuinely intended to be public (e.g., `public fun deposit(coin: Coin<T>, ...)` on a public vault).
- **Severity**: Critical
- **Fix**: Change to `fun` (internal) or `public(package) fun` if package-internal access is needed. Add `_: &AdminCap` parameter if admin-only access is required.

---

### [Rule ID: ML-ACC-002] public(package) Mistaken for Access Control

> **⚙️ Implementation: `REGEX`** — Pattern: `public\(package\)\s+(?:entry\s+)?fun\s+\w+[^(]*\([^)]*\)(?!.*(?:AdminCap|OwnerCap)).*(?:transfer|mint|withdraw|delete)`


- **Pattern**: `public(package) fun` used as a security boundary for an operation that should require a capability, without realising that any module within the same package can call it — and the package may have multiple modules with different trust levels.
- **Real Case**: Monethic workshop (Jan 2026): "One of the most dangerous misconceptions in Sui Move is assuming that `public(package)` visibility provides meaningful access control." Documented pattern: `public(package) entry fun emergency_withdraw(vault: &mut Vault, ctx: &mut TxContext)` — no cap check, callable by any module in the package.
- **Detection Logic**: IF function is `public(package)` AND function performs a high-value operation (transfer, mint, withdraw, delete privileged object) AND no capability parameter is present THEN flag as **High**.
- **False Positive**: Internal helpers used only within a tightly controlled single-module package where no other module exists.
- **Severity**: High
- **Fix**: Add `_: &AdminCap` or equivalent typed capability as parameter. Do not rely on visibility alone as authorization.

---

### [Rule ID: ML-ACC-003] Hardcoded Address Authorization

> **⚙️ Implementation: `REGEX`** — Pattern: `assert!\s*\(\s*ctx\.sender\(\)\s*==\s*@0x[0-9a-fA-F]+`


- **Pattern**: Access control via `assert!(ctx.sender() == @0xSOME_ADDRESS, ENotAuthorized)` using a hardcoded address constant.
- **Real Case**: Move Book documents this as the anti-pattern explicitly replaced by capability objects. SlowMist primer flags it as insufficient for production protocols.
- **Detection Logic**: IF function contains `assert!(ctx.sender() == @0x...` with a literal address constant THEN flag as **Medium**.
- **False Positive**: Test-only modules using test addresses. One-time setup functions (`init`).
- **Severity**: Medium
- **Fix**: Replace with capability pattern. Define `struct AdminCap has key {}` in `init`, transfer to deployer. Require `_: &AdminCap` in privileged functions.

---

### [Rule ID: ML-ACC-004] Generic Capability — Phantom Type Substitution Attack

> **🔍 Implementation: `AST`** — Capability struct with generic type param; privileged fn accepts unconstrained <R>


- **Pattern**: Capability struct parameterized over a generic type without `phantom` constraint, e.g. `struct RoleCap<R> has key, store { id: UID }`, and a privileged function accepts `_role: &RoleCap<R>` accepting any `R`. An attacker supplies `RoleCap<UserRole>` to a function intended only for `RoleCap<AdminRole>`.
- **Real Case**: Monethic workshop (Jan 2026): Directly documented — `public fun moderator_checkout_admin<R>(_role: &RoleCap<R>, ...)` accepts any role including unprivileged ones.
- **Detection Logic**: IF a capability struct has a generic type parameter AND a privileged function accepts that capability with unconstrained generic `<R>` THEN flag as **Critical**.
- **False Positive**: Generic capabilities that are explicitly designed to accept multiple role types with downstream type-specific checks.
- **Severity**: Critical
- **Fix**: Use concrete types: `_: &AdminCap` not `_: &RoleCap<AdminRole>`. If generics needed, add phantom type and verify against expected type at runtime.

---

### [Rule ID: ML-ACC-005] Caller vs Sender Confusion

> **⚙️ Implementation: `REGEX`** — Pattern: `assert!\s*\(\s*\w+\s*==\s*\w+\.(admin|owner)`


- **Pattern**: Code checks `caller == vault.admin` where `caller` is a passed-in address argument (not `ctx.sender()`), allowing any transaction sender to pass an arbitrary address and impersonate admin.
- **Real Case**: Monethic workshop (Jan 2026): "The check `caller == vault.admin` passes, but the actual transaction sender is the attacker. The function performs privileged operations on behalf of someone who isn't actually executing the transaction."
- **Detection Logic**: IF a privileged function takes an `address` parameter AND access control assert uses that parameter (not `ctx.sender()`) THEN flag as **Critical**.
- **False Positive**: Functions that correctly validate both the passed address AND `ctx.sender()`.
- **Severity**: Critical
- **Fix**: Always derive authority from `ctx.sender()` or from a capability object the sender must own. Never trust address arguments as proof of identity.

---

### [Rule ID: ML-ACC-006] Missing Access Control on Shared Object

> **🔍 Implementation: `AST`** — public/entry fun takes &mut T (shared object type), no capability param


- **Pattern**: Public or entry function operates on a shared object (e.g., a pool object passed as `&mut T`) without any access control checks or capability arguments (such as `&AdminCap` or dynamic caller checks).
- **Real Case**: NomosLabs reports that Sui shared objects (e.g., liquidity pools) are by default accessible to any transaction. Auditors frequently find functions that operate on shared objects without any access check, assuming that the runtime restricts execution.
- **Detection Logic**: IF a public or entry function takes a parameter of a shared object type `&mut T` (where `T` is declared with shared ability or is a shared object) AND the function does not accept a capability parameter (like `&AdminCap`, `&OwnerCap`) AND there is no caller authorization check (e.g., verifying `ctx.sender()`) THEN flag as **High**.
- **False Positive**: Functions that are intentionally public by design (e.g., public read-only functions, or public deposit functions where anyone can swap or add liquidity).
- **Severity**: High
- **Fix**: Enforce capability checks. Either make the function `public(package)` (if only internal callers should access it) or require a capability argument: e.g., `public fun withdraw(_cap: &AdminCap, pool: &mut Pool, amount: u64)`.

---

### [Rule ID: ML-ACC-007] Capability with Store/Copy Abilities

> **⚙️ Implementation: `REGEX`** — Pattern: `struct\s+\w*[Cc]ap\w*\s+has\s+[^{]*(store|copy)`


- **Pattern**: A capability struct (e.g., named with a `Cap` suffix) is defined with `store` or `copy` abilities, enabling the capability to be duplicated, transferred via public operations, or moved into shared storage, which breaks the exclusivity of the authorization.
- **Real Case**: NomosLabs reports many cases where a capability struct is defined with `store` or `copy` abilities, allowing users to clone the capability or store it inside other objects, bypassing strict ownership checks.
- **Detection Logic**: IF a struct definition ends with `Cap` (or represents an authorization capability) AND it contains `store` or `copy` in its ability list THEN flag as **High**.
- **False Positive**: Very rare. In some specialized cases, a capability might require `store` if it is nested inside another single-owner object, but it should almost never have both `store` and `copy`.
- **Severity**: High
- **Fix**: Remove `store` and `copy` abilities from capability structs. Capabilities should typically only have the `key` ability to remain non-copyable and bound to direct ownership.

---

### [Rule ID: ML-ACC-008] Non-Exclusive Framework Capability Used as Authorization Gate

> **⚙️ Implementation: `REGEX`** — Pattern: `fun\s+\w+[^(]*\([^)]*UpgradeCap[^)]*\)(?!.*package::upgrade_package)`


- **Pattern**: Gating privileged operations on a Sui framework capability type that any package publisher or user can obtain (e.g., `&UpgradeCap`, `&Publisher`, `&CoinMetadata<T>`, `&Clock`, `&Random`) without validating the capability's specific instance ID or package owner.
- **Real Case**: Pawtato Finance (Jan 28, 2026 exploit, OpenZeppelin Notorious Bug Digest #8): `create_new_admin_cap` accepted any `UpgradeCap` argument without calling `package::upgrade_package(&UpgradeCap)` to verify the package ID. An attacker deployed a trivial contract for minimal gas, obtained an `UpgradeCap`, generated an admin capability, and drained the liquidity pools.
- **Detection Logic**: IF a privileged function relies on a framework-defined capability type (`UpgradeCap`, `Publisher`, `CoinMetadata`, `Clock`, `Random`) for authorization AND does not call a validation function (such as `package::upgrade_package`) to verify its identity THEN flag as **Critical**.
- **False Positive**: Custom capabilities defined within the package itself, which are protected by Move's type exclusivity, or framework capabilities whose specific identities are checked.
- **Severity**: Critical
- **Fix**: Validate the capability's identity at runtime using framework helpers: e.g., `assert!(package::upgrade_package(upgrade_cap) == @expected_package_address, EInvalidUpgradeCap);`.

---

### [Rule ID: ML-ACC-009] Privilege Escalation via Weakly-Gated Capability Minting

> **🔍 Implementation: `AST`** — Fn creates+returns capability object; guard weaker than conferred privilege


- **Pattern**: A function that mints or upgrades authorization capabilities is guarded by a weak permission check, allowing an attacker to mint highly privileged capability objects and bypass downstream access control.
- **Real Case**: Pawtato Finance exploit (Jan 28, 2026): A function producing package capability credentials trusted a weak root gate (accepting any `UpgradeCap`). Attacking this weak root enabled the generation of high-privilege credentials that compromised downstream functions in the delegation chain.
- **Detection Logic**: IF a function creates and returns/transfers a capability object AND the access control guarding this function is weaker than the privileges conferred by the returned capability THEN flag as **High**.
- **False Positive**: Capabilities minted only during initial deployment (`init` functions) or guarded by concrete, verified administrative capabilities.
- **Severity**: High
- **Fix**: Enforce that capability-minting functions are strictly protected by authorization checks equivalent to or stronger than the capabilities they produce.

---

### [Rule ID: ML-ACC-010] entry Modifier Defeats public(package)/Private Intent

> **⚙️ Implementation: `REGEX`** — Pattern: `entry\s+fun\s+\w+[^(]*\([^)]*\)(?!.*(?:AdminCap|ctx\.sender)).*(?:transfer|withdraw|delete)`


- **Pattern**: Marking a privileged function as `entry` without any internal access checks, mistakenly assuming that a visibility modifier like `public(package)` or private visibility will restrict external callers. The `entry` modifier makes the function directly callable by any transaction in a PTB.
- **Real Case**: Monethic Sui Move workshop (Jan 2026): An emergency withdrawal function declared as `public(package) entry fun emergency_withdraw` allowed attackers to call the entry point directly via `sui client call`, bypassing the intended package boundary.
- **Detection Logic**: IF a function is marked as `entry` AND performs state modifications or asset transfers AND has no capability arguments or caller checks (`ctx.sender()`) THEN flag as **High**.
- **False Positive**: Public entry functions that are intentionally open to all callers and perform their own internal validation.
- **Severity**: High
- **Fix**: Remove the `entry` keyword from internal helper functions, and ensure all entry points explicitly validate caller permissions.

---

### [Rule ID: ML-ACC-011] Generic Witness Accepted in Policy/Rule Without Verification

> **🔍 Implementation: `AST`** — Generic witness W:drop in policy fn with no has_rule verification call


- **Pattern**: Accepting a generic witness `W: drop` to authorize policy rules or configurations without checking that `W` is the expected witness type registered for the policy, allowing a foreign witness to satisfy the security check.
- **Real Case**: Standard finding in Sui `TransferPolicy` audits: custom rule modules allow any generic `Rule` witness to add/withdraw fees or modify rules without validating that the witness matches the registered rule structure.
- **Detection Logic**: IF a function accepts a generic witness parameter `W: drop` for authorization AND does not call a verification helper (like `has_rule`) to check the witness type THEN flag as **High**.
- **False Positive**: Functions where the witness is explicitly type-constrained to a concrete package type.
- **Severity**: High
- **Fix**: Verify that the witness belongs to the registered rule type using `has_rule<T, Rule>` or explicitly assert the witness type.

---

### [Rule ID: ML-ACC-012] signer or SignerCapability Stored by or Handed to Untrusted Module

> **🔍 Implementation: `AST`** — Signer or SignerCapability passed to external module function


- **Pattern**: Passing a `&signer` reference to an untrusted external module or storing a `SignerCapability` in public/shared storage, allowing external modules to impersonate the user or resource account.
- **Real Case**: SlowMist Aptos auditing primer: "if we give the signer to an unknown module... resources under our account may be maliciously operated." In resource accounts, exposing `SignerCapability` grants upgrade and mint permissions to anyone who accesses the cap.
- **Detection Logic**: IF a `&signer` is passed to a function in a different module (non-framework) OR a `SignerCapability` is returned or stored in a public/shared resource THEN flag as **Critical**.
- **False Positive**: Passing signers to internal package modules or trusted framework functions.
- **Severity**: Critical
- **Fix**: Never expose `SignerCapability` or pass `&signer` to external or untrusted modules. Store capabilities privately with strict access gates.

---

### [Rule ID: ML-ACC-013] Resource Account or Derived Address Pre-Claim Squatting

> **⏭️ Implementation: `SKIP_MVP`** — Requires predictable-seed analysis and on-chain address lookup


- **Pattern**: Creating a resource account or derived address based on predictable user-influenced seeds without verifying address freshness, enabling an attacker to pre-create or pre-fund the address and claim ownership of the account.
- **Real Case**: Aptos `account.move` documentation details security rules for resource-account creation where attackers can offer/squat resource accounts if seeds are predictable. Similar to Sui derived address pre-claim issues.
- **Detection Logic**: IF an account is created using predictable inputs or caller-influenced seeds AND there is no freshness validation or owner registration check THEN flag as **Medium**.
- **False Positive**: Using cryptographically secure random seeds or unique UUIDs.
- **Severity**: Medium
- **Fix**: Use unpredictable or hard-coded package seeds when deriving addresses, and verify that the target address has no pre-existing balance or transactions.

---

## SECTOR: Object Ownership & Permission Checks

### [Rule ID: ML-OBJ-001] Missing Object Ownership Verification

> **⚙️ Implementation: `REGEX`** — Pattern: `fun\s+\w+[^(]*\(&mut\s+\w+[^)]*\)(?!.*assert!.*\.owner\s*==\s*ctx\.sender)`


- **Pattern**: Function accepts a mutable reference to a user-owned object (`&mut UserAccount`) but does not assert that `ctx.sender()` is the object's owner. Any transaction can mutate any user's object.
- **Real Case**: SlowMist auditing primer (2024): "In SUI, objects can be converted into shared objects, meaning their access rights may change from private to public. It is necessary to carefully review all objects in use to clarify whether each object is static or shared."
- **Detection Logic**: IF a function accepts `&mut T` where `T` has field `owner: address` or similar AND no `assert!(object.owner == ctx.sender(), ...)` present THEN flag as **High**.
- **False Positive**: Shared objects where multi-party mutation is intended by design (e.g., a public AMM pool).
- **Severity**: High
- **Fix**: Add `assert!(account.owner == ctx.sender(), ENotOwner);` before any mutation.

---

### [Rule ID: ML-OBJ-002] Shared Object Misclassification

> **⚙️ Implementation: `REGEX`** — Pattern: `transfer::(?:public_)?share_object\s*\(\s*\w*(?:[Bb]alance|[Vv]ault|[Aa]ccount|[Ww]allet)\w*`


- **Pattern**: Object created with `transfer::share_object(obj)` when it should be `transfer::transfer(obj, sender)`. Shared objects can be mutated by anyone in a transaction; owned objects require explicit ownership transfer.
- **Real Case**: SlowMist primer flags this as a critical review item. Multiple audit findings across unnamed Sui DeFi protocols.
- **Detection Logic**: IF `transfer::share_object(T)` is called on a type that contains sensitive per-user fields (e.g., balance, keys, personal data) THEN flag as **High**.
- **False Positive**: Protocol-level shared objects like AMM pools, governance contracts, shared registries — these are legitimately shared.
- **Severity**: High
- **Fix**: Audit every `share_object` call. Only share objects that are explicitly designed for multi-party concurrent access with proper authorization guards on mutations.

---

### [Rule ID: ML-OBJ-003] Unauthorized Object Mutation via Shared Reference Upgrade

> **⚙️ Implementation: `REGEX`** — Pattern: `fun\s+\w+[^(]*\(&\s+\w+[^)]*\).*dynamic_field::(?:add|remove)`


- **Pattern**: Function takes `&T` (immutable reference) but extracts and modifies interior mutable state through dynamic fields or interior mutability patterns not visible from the type signature.
- **Real Case**: Zellic "Move Fast & Break Things Part 2" (Dec 2022) documented UID swapping and object hiding bugs where bytecode verifier was bypassable pre-patch.
- **Detection Logic**: IF function parameter is `&T` (immutable ref) AND body calls `dynamic_field::add`, `dynamic_field::remove`, or `dynamic_object_field::add` on that reference THEN flag as **High**.
- **False Positive**: Legitimate read-only dynamic field lookups using `dynamic_field::borrow`.
- **Severity**: High
- **Fix**: Use `&mut T` explicitly for any operation that modifies the object's logical state, even through dynamic fields.

---

### [Rule ID: ML-OBJ-004] Capability Single-Use Violation

> **⚙️ Implementation: `REGEX`** — Pattern: `struct\s+\w*(?:[Rr]eceipt|[Cc]ap|[Vv]oucher)\w*\s+has\s+[^{]*\bdrop\b`


- **Pattern**: Withdrawal or privileged capability object is not consumed (destroyed) after use, allowing it to be reused multiple times for repeated withdrawals or privilege escalation.
- **Real Case**: MWC taxonomy paper (arxiv 2505.19047, 2025): "A Sui-based DEX was found to have a flaw in which the withdrawal logic failed to enforce single-use constraints on capability objects. This allowed an attacker to reuse the same capability multiple times, violating Move's resource linearity in practice."
- **Detection Logic**: IF a capability struct has `drop` ability (or is returned from a function without destruction) AND it guards a resource withdrawal operation THEN flag as **Critical**.
- **False Positive**: Long-lived admin capabilities that are intentionally reusable (e.g., `AdminCap` for protocol config).
- **Severity**: Critical
- **Fix**: Design single-use receipts as hot potatoes (no abilities). If reuse is intended, track nonce/epoch in the capability and assert it has not been used for the current operation.

---

### [Rule ID: ML-OBJ-005] Capability or Asset Shared via public_share_object Instead of Transferred

> **⚙️ Implementation: `REGEX`** — Pattern: `transfer::(?:public_)?share_object\s*\(\s*\w*(?:[Aa]dmin|[Oo]wner|[Cc]ap)\w*`


- **Pattern**: Creating a capability or administrative object (e.g., `AdminCap`, `OwnerCap`) and publishing it via `transfer::public_share_object(cap)` or `transfer::share_object(cap)`. This makes the capability public and allows any transaction caller to use it.
- **Real Case**: Mirage Audits ("The Ability Mistakes That Will Drain Your Sui Move Protocol"): Multiple production audits found `transfer::public_share_object(admin_cap)` being used, which turned private administrative functions into publicly accessible ones while passing general compile checks.
- **Detection Logic**: IF an object containing capability/authority keywords in its name (`*Cap`, `*Admin*`, `*Owner*`) is passed to `share_object` or `public_share_object` THEN flag as **Critical**.
- **False Positive**: Configurations or system parameters that are intentionally shared for read-only access and do not contain administrative capabilities.
- **Severity**: Critical
- **Fix**: Transfer administrative capability objects directly to the deployer's address using `transfer::transfer(cap, tx_context::sender(ctx))` in the module's `init` function.

---

### [Rule ID: ML-OBJ-006] store Ability Added to Object Enabling public_transfer Bypass

> **🔍 Implementation: `AST`** — Type with custom transfer function also declares store ability


- **Pattern**: Declaring a struct with the `store` ability when it enforces custom transfer logic through a dedicated transfer module. The `store` ability allows any user to bypass the custom transfer module and move the object freely using `transfer::public_transfer`.
- **Real Case**: Sui official documentation warns that adding the `store` ability to assets needing custom transfer rules allows players to sell or transfer assets directly in secondary markets, bypassing royalty fees or restriction checks.
- **Detection Logic**: IF a type defines a custom transfer function enforcing a predicate AND the same type declares `store` AND no other mechanism prevents `public_transfer` THEN flag as **High**.
- **False Positive**: General tokens or assets designed to be freely tradeable on secondary marketplaces without restrictions.
- **Severity**: High
- **Fix**: Remove the `store` ability from structs that require custom transfer verification, allowing them to be moved only via the module's custom transfer functions.

---

### [Rule ID: ML-OBJ-007] UID Resurrection via Extracting and Re-wrapping

> **⚙️ Implementation: `REGEX`** — Pattern: `let\s+\w+\s*=\s*\w+\.id;(?!.*object::delete)`


- **Pattern**: Destructuring a restricted object to extract its `UID` field, and then re-wrapping that same `UID` inside a new struct. This bypasses the asset's transfer/store restrictions by preserving the underlying object ID in a different wrapper.
- **Real Case**: Zellic Sui Security Primer (Part 2): Illustrated a vulnerability where a `key`-only object (non-transferable) was destructured to extract its `UID`, which was then stored in a `store` wrapper, bypassing the lack of the `store` ability on the original type.
- **Detection Logic**: IF a module unpacks a struct to extract its `UID` field AND that `UID` is subsequently stored in a different struct rather than deleted THEN flag as **High**.
- **False Positive**: Migrating system structures or upgrading objects where UID conservation is explicitly audited.
- **Severity**: High
- **Fix**: Avoid writing functions that unpack restricted structs and export their `UID`. Always delete `UID`s using `object::delete(uid)` when destroying objects.

---

### [Rule ID: ML-OBJ-008] Function Assumes Single-Owner Provenance but Accepts Frozen/Shared Object

> **🔍 Implementation: `AST`** — Function reads owner identity from a shared/frozen object param


- **Pattern**: Function logic assumes that an object argument is owned exclusively by the caller, but the object's type has `store` or can be shared/frozen. Frozen and shared objects are globally passable by reference, allowing anyone to supply them.
- **Real Case**: Zellic Sui Primer notes that because frozen objects are global and immutable, any user can pass a frozen object to a smart contract, which may lead to privilege bypass if the code assumes the caller is the exclusive owner.
- **Detection Logic**: IF a function reads owner identity or permissions from an object parameter AND that object is shared or frozen THEN flag as **High**.
- **False Positive**: Legitimate read-only global configurations that do not grant user privileges.
- **Severity**: High
- **Fix**: Derive execution authority strictly from owned capabilities or `ctx.sender(ctx)`, never from the properties of a shared or frozen object.

---

### [Rule ID: ML-OBJ-009] Derived-Object ID Prediction or Pre-Claim Squatting

> **⚙️ Implementation: `REGEX`** — Pattern: `derived_object::claim|transfer::public_receive`


- **Pattern**: Relying on deterministic object addresses (such as `derived_object::derive_address(parent_id, key)`) without validating that the address was not pre-claimed or pre-funded by an attacker prior to object creation.
- **Real Case**: Sui "Derived Objects" documentation warning: because derived addresses are deterministic and computed off-chain, an attacker can pre-fund the derived address or claim it before the legitimate application attempts to claim it.
- **Detection Logic**: IF code uses `derived_object::claim` or `transfer::public_receive` on a deterministic derived address AND lacks an authorization check on the creator/recipient THEN flag as **Medium**.
- **False Positive**: Registry designs where creation is strictly access-controlled and address uniqueness is verified.
- **Severity**: Medium
- **Fix**: Restrict derived address creation to admin/authorized capabilities, and verify that the derived address has no pre-existing balance before operations.

---

### [Rule ID: ML-OBJ-010] Unauthorized receive or public_receive from Shared Object

> **⚙️ Implementation: `REGEX`** — Pattern: `transfer::(?:public_)?receive\s*\((?!.*(?:assert!.*sender|AdminCap))`


- **Pattern**: Exposing a public function that calls `transfer::receive` or `transfer::public_receive` using a shared object's `&mut UID` without checking caller credentials, allowing anyone to claim objects sent to that shared address.
- **Real Case**: Sui "Transfer to Object" guidelines: a shared object can receive other objects, but since shared objects are public, developers must implement strict caller validation checks to prevent unauthorized users from claiming incoming assets.
- **Detection Logic**: IF `transfer::receive` or `transfer::public_receive` is called on a shared object's `&mut UID` AND there is no caller permission or capability assertion check THEN flag as **High**.
- **False Positive**: Receiving operations on owned objects, which are already protected by the runtime's ownership checks.
- **Severity**: High
- **Fix**: Require capability arguments (e.g., `&AdminCap`) or assert that the caller is authorized: `assert!(tx_context::sender(ctx) == pool.owner, EUnauthorized);`.

---

### [Rule ID: ML-OBJ-011] Deleting Object with Non-drop Dynamic Fields Locks Values

> **⚙️ Implementation: `REGEX`** — Pattern: `object::delete\s*\(\s*\w+\s*\)(?!.*dynamic_field::remove)`


- **Pattern**: Calling `object::delete(id)` on a parent object that still has dynamic fields or dynamic object fields attached to it. This leaves all child fields permanently orphaned and locked on-chain.
- **Real Case**: Sui framework developer warning: deleting a parent object that has dynamic fields still defined on it renders all children inaccessible, regardless of whether the fields have the `drop` ability, leading to locked funds.
- **Detection Logic**: IF `object::delete` is called on an object that has active `dynamic_field::add` or `dynamic_object_field::add` calls in the module AND there is no preceding removal loop THEN flag as **High**.
- **False Positive**: Ephemeral objects that are guaranteed to have no dynamic fields attached during deletion.
- **Severity**: High
- **Fix**: Always query, remove, and destroy all dynamic fields (using `dynamic_field::remove`) before deleting the parent object's `UID`.

---

### [Rule ID: ML-OBJ-012] Kiosk or TransferPolicy Royalty Bypass via KioskOwnerCap Transfer

> **🔍 Implementation: `AST`** — TransferPolicy registered without kiosk_lock_rule and personal_kiosk_rule


- **Pattern**: Relying on `TransferPolicy` rules to enforce NFT secondary royalties without implementing the Personal Kiosk Rule or Lock Rule, allowing sellers to transfer the `KioskOwnerCap` (or use single-item kiosks) to move assets without triggering a `TransferRequest`.
- **Real Case**: Sui Developer Forum reports: NFT sellers bypass royalty policies by selling the entire `KioskOwnerCap` containing the NFT rather than selling the NFT itself. The NFT remains inside the kiosk, and the buyer assumes control of the kiosk without royalty fees.
- **Detection Logic**: IF a type has a registered `TransferPolicy` with royalty fees AND does not enforce the Lock Rule and Personal Kiosk Rule THEN flag as **Medium**.
- **False Positive**: NFT collections that deliberately allow royalty-free transfers.
- **Severity**: Medium
- **Fix**: Enforce the `kiosk_lock_rule` and `personal_kiosk_rule` in the transfer policy, requiring NFTs to be traded only within locked kiosks.

---

### [Rule ID: ML-OBJ-013] Exclusive Listing or PurchaseCap Loss Locks Kiosk Item

> **⚙️ Implementation: `REGEX`** — Pattern: `list_with_purchase_cap\s*\(.*\n.*transfer::public_transfer`


- **Pattern**: Issuing a `PurchaseCap` for an NFT listing inside a kiosk (using `list_with_purchase_cap`) and transferring it to an untrusted account or outside of an atomic transaction. If the `PurchaseCap` is lost or not returned, the NFT is permanently locked inside the kiosk.
- **Real Case**: Sui Kiosk official guidelines: "losing a PurchaseCap would lock the item in the Kiosk forever... only use PurchaseCap functionality in trusted applications and not... for direct trading."
- **Detection Logic**: IF `list_with_purchase_cap` is used AND the resulting `PurchaseCap` is transferred to an external address rather than consumed atomically THEN flag as **Medium**.
- **False Positive**: Escrow contracts or listing platforms that programmatically guarantee the return or execution of the `PurchaseCap`.
- **Severity**: Medium
- **Fix**: Limit the use of `PurchaseCap` to atomic transaction blocks where the cap is guaranteed to be consumed or returned to the kiosk within the same PTB.

---

## SECTOR: Integer Overflow & Bitwise Arithmetic

### [Rule ID: ML-INT-001] Bitwise Shift Overflow — Cetus Class

> **⚙️ Implementation: `REGEX`** — Pattern: `0xffffffffffffffff\s*<<\s*192|u256[^;]*<<\s*64(?!.*checked_shl)`


- **Pattern**: Left-shift operation (`<<`) on a `u256` or `u128` value where the shift amount may produce a result that silently wraps/truncates. Specifically: using `0xFFFFFFFFFFFFFFFF << N` as an overflow-check mask instead of `0x1 << N`.
- **Real Case**: **Cetus Protocol — May 22, 2025 — $223M loss.** `checked_shlw` function in `integer-mate` library used `let mask = 0xffffffffffffffff << 192` to check overflow before shifting a 256-bit value. Correct mask should be `let mask = 1 << 192`. Because the mask was `2^64 - 1` times too large, the overflow check `n > mask` evaluated to `FALSE` for exploit-crafted inputs, allowing `2^192+ε` to pass and truncate to `ε` after the shift.
- **Detection Logic**: IF `<<` operator is used on `u256` type AND the overflow guard compares result against `0xFFFFFFFFFFFFFFFF << N` or similar multi-bit mask (not `1 << N`) THEN flag as **Critical**. Additionally flag any `<<` on `u256`/`u128` with no preceding overflow check as **High**.
- **False Positive**: Bitwise shifts used for pure bit manipulation (flags, masks) where the full bit range is intentional and no liquidity/price calculation follows.
- **Severity**: Critical
- **Fix**: Replace `let mask = 0xffffffffffffffff << N` with `let mask = 1u256 << N`. Use `n >= mask` not `n > mask`. Add fuzz tests at boundary values `2^N - 1`, `2^N`, `2^N + 1`.

---

### [Rule ID: ML-INT-002] Missing Overflow Guard on Bitwise Shift

> **⚙️ Implementation: `REGEX`** — Pattern: `\bu256\b[^;]*<<\s*\d+(?!.*(?:assert!|checked_shl))`


- **Pattern**: `<<` used on `u256`/`u128`/`u64` in a financial calculation context with no explicit overflow check before the shift. Move's type system allows bit shifts to overflow silently (unlike addition/subtraction which abort).
- **Real Case**: SlowMist auditing primer (2024): "Move automatically checks for overflow during mathematical operations. If an overflow occurs, the transaction will fail. However, it is important to note that bitwise operations in Move do not undergo overflow checks." Cetus hack confirmed this property was exploitable.
- **Detection Logic**: IF `<<` operator appears in a function that involves balance/liquidity/price math AND no bounds check (`assert!(val < 1u256 << N, EOverflow)` or equivalent) precedes it THEN flag as **High**.
- **False Positive**: `<<` used in non-financial contexts (bitmask construction for flags, hash operations).
- **Severity**: High
- **Fix**: Before any `val << N`, assert `val < (1u256 << (256 - N))`. Use safe shift wrappers that abort on overflow.

---

### [Rule ID: ML-INT-003] Incorrect Bit Mask Width for Boundary Check

> **⚙️ Implementation: `REGEX`** — Pattern: `0xffffffffffffffff\s*<<\s*\d+`


- **Pattern**: Overflow/boundary check uses wrong integer type width. E.g., checking `(value >> 64) != 0` to detect overflow in a 256-bit context — this only detects overflow in bits 64–127, missing overflow in bits 128–255.
- **Real Case**: Dedaub analysis of Cetus (2025): "The original mask was too large by a factor of 2^64 - 1." The bug was introduced when code was ported from Aptos (which does not have native `u256`) to Sui (which does). The boundary check was written for 192-bit semantics but the value had 256-bit range.
- **Detection Logic**: IF a `u256` value is checked against a mask whose bit width is less than 192 bits before being used in a calculation that can produce 192+ bit intermediate results THEN flag as **Critical**.
- **False Positive**: Intentional partial checks where upper bits are known to be zero by construction.
- **Severity**: Critical
- **Fix**: Explicitly compute the maximum valid input for each mathematical operation and assert against it. Document the expected bit range of every intermediate value.

---

### [Rule ID: ML-INT-004] Division by Zero — Unguarded Denominator

> **⚙️ Implementation: `REGEX`** — Pattern: `[^;]+[/%]\s*\w+(?!.*assert!\s*\(\s*\w+\s*!=\s*0)`


- **Pattern**: Division expression `a / b` where `b` is derived from user input or pool state that could be zero, without a preceding `assert!(b != 0, EDivisionByZero)`.
- **Real Case**: Standard finding in MoveBit, OtterSec, and Zellic audit reports for AMM protocols. Any price/ratio calculation from an empty pool hits this.
- **Detection Logic**: IF `/` or `%` operator used AND the denominator variable is not a compile-time constant AND no `assert!(denominator != 0, ...)` guard precedes it THEN flag as **Medium**.
- **False Positive**: Denominators that are structurally non-zero (e.g., `total_supply` initialized to `1` in `init`).
- **Severity**: Medium
- **Fix**: `assert!(denominator != 0, EDivisionByZero);` before every dynamic division. Consider providing a dedicated `checked_div` function that aborts on zero.

---

### [Rule ID: ML-INT-005] Unsafe u64/u128 Truncation in mul_div Pattern

> **⚙️ Implementation: `REGEX`** — Pattern: `let\s+\w+\s*:\s*u64\s*=\s*\(?\w+\s*\*\s*\w+\)?\s*/`


- **Pattern**: Intermediate multiplication of two `u64` values (result could be `u128`) stored back in `u64` before division, truncating the high bits. Pattern: `let result: u64 = (a * b) / c` where `a * b` can exceed `u64::MAX`.
- **Real Case**: Common finding in Sui AMM audits. OtterSec and MoveBit audit reports for Cetus, Turbos, and NAVI all note intermediate overflow in liquidity math.
- **Detection Logic**: IF two `u64` variables are multiplied (`*`) AND result is stored in `u64` before division (not upcast to `u128` or `u256` first) THEN flag as **High**.
- **False Positive**: Multiplications where both operands are known to be small (e.g., `fee_rate * 100` where `fee_rate < 10000`).
- **Severity**: High
- **Fix**: `let result: u128 = (a as u128) * (b as u128) / (c as u128); let result_u64 = result as u64;` with an overflow assertion on the final cast.

---

### [Rule ID: ML-INT-006] Silent Truncation via Narrowing Cast

> **⚙️ Implementation: `REGEX`** — Pattern: `as\s+u(?:64|32|16|8)(?!.*assert!)`


- **Pattern**: Casting a large integer (such as `u256` or `u128`) to a smaller type (like `u64` or `u32`) using `(x as u64)` without asserting that the value is within the maximum limit of the target type. In Move, arithmetic operations abort on overflow, but type casts truncate silently.
- **Real Case**: Cetus Protocol Sui audit: Converting a `u256` intermediate arithmetic result to a `u64` type caused silent truncation when the value exceeded `MAX_U64`, leading to significant accounting errors in large trade swaps.
- **Detection Logic**: IF a variable of type `u256` or `u128` is cast to a smaller integer type (`u64`, `u32`, `u16`, `u8`) AND there is no preceding assertion checking the maximum value of the target type THEN flag as **High**.
- **False Positive**: Values that are mathematically bounded by design constants (e.g., casting a percentage BPS value ≤ 10,000 to `u64`).
- **Severity**: High
- **Fix**: Always assert the value bounds before performing a narrowing cast: `assert!(value <= (18446744073709551615u256), EOverflow);` (for `u64` max).

---

## SECTOR: Arithmetic Precision Loss

### [Rule ID: ML-ARI-001] Division Before Multiplication

> **⚙️ Implementation: `REGEX`** — Pattern: `\(\s*\w+\s*/\s*\w+\s*\)\s*\*\s*\w+`


- **Pattern**: Expression of the form `(a / b) * c` in financial calculation where `a / b` truncates to integer before being multiplied, causing systematic precision loss. Correct order: `(a * c) / b`.
- **Real Case**: Universal DeFi vulnerability class. OpenZeppelin notable bug digest (2026) covers the Neutron DEX rounding attack where "ceiling-rounded share counts were multiplied by a large price factor during order cancellation, causing significant over-subtraction that could reduce other users' withdrawable funds to zero." Balancer Stable Pool attack (2023) exploited `mulDown` with `8-9 wei` pool balances via 65 micro-swaps accumulating rounding error.
- **Detection Logic**: IF a function contains `(expr1 / expr2) * expr3` AND any expression involves balance, price, rate, or liquidity variables THEN flag as **High**.
- **False Positive**: Percentage calculations where division by a constant (e.g., 100) is intentionally first and the result is a coefficient.
- **Severity**: High
- **Fix**: Reorder to `(a * c) / b`. If overflow risk: use `u128`/`u256` for intermediate value. Consider fixed-point library with `mul_div(a, c, b)` that maintains precision.

---

### [Rule ID: ML-ARI-002] Insufficient Fixed-Point Scale Factor

> **⚙️ Implementation: `REGEX`** — Pattern: `(?:PRECISION|SCALE|FACTOR)\s*[=:]\s*1_?0{3,7}(?!_?0{3})\b`


- **Pattern**: Fixed-point arithmetic using scale factor `1e6` (6 decimal places) for calculations that require 18+ decimal precision, causing accumulated rounding drift in multi-step calculations.
- **Real Case**: Multiple DeFi protocols on Sui use `1_000_000` as their precision constant instead of `1_000_000_000_000_000_000`. Over many operations, this compounds.
- **Detection Logic**: IF a module defines a `PRECISION` or `SCALE` constant less than `1_000_000_000` (1e9) AND uses it in interest/rate/price calculations THEN flag as **Medium**.
- **False Positive**: Protocols that explicitly document lower precision as intentional and acceptable for their use case.
- **Severity**: Medium
- **Fix**: Use at minimum `1e9` precision for DeFi math. Use `1e18` for high-value AMM pools. Document precision loss bounds explicitly.

---

### [Rule ID: ML-ARI-003] Rounding Direction Inconsistency (Protocol Favors Attacker)

> **🔍 Implementation: `AST`** — Both protocol and user amounts use same truncating integer division


- **Pattern**: When computing amounts owed TO the protocol (fees, interest), rounding is done DOWN (`/ denom` with truncation). When computing amounts owed TO the user (withdrawals, rewards), rounding is also DOWN — instead of UP for protocol amounts and DOWN for user amounts. This allows systematic extraction of value from the protocol.
- **Real Case**: OZ Notorious Bug Digest #8 (April 2026): Neutron DEX ceiling-rounded share counts creating over-subtraction. Multiple audit findings in NAVI and Scallop lending protocols.
- **Detection Logic**: IF a function computes both "amount owed to protocol" and "amount owed to user" AND both use the same rounding direction (both truncating) THEN flag as **Medium**.
- **False Positive**: Protocols where all rounding is in the same direction by explicit design with documented invariant proofs.
- **Severity**: Medium
- **Fix**: Protocol amounts (fees, collateral requirements): round UP (add `denominator - 1` before dividing). User amounts (withdrawals, rewards): round DOWN. Use `math::div_up(a, b)` and `math::div_down(a, b)` explicitly.

---

### [Rule ID: ML-ARI-004] Price Calculation Drift — Accumulated Rounding

> **🔍 Implementation: `AST`** — Division result stored to struct field, later read as multiplier


- **Pattern**: Price or exchange rate computed as integer division that loses fractional precision, and this imprecise value is stored and used as a multiplier in subsequent calculations, compounding the error over many transactions.
- **Real Case**: InfyniSec Cetus analysis (Aug 2025): "Some reports also noted a related rounding bug in the `integer-mate` library, exacerbating price curve distortions when spoof tokens were injected."
- **Detection Logic**: IF a computed price/rate value (result of division) is written to storage AND subsequently used in multiplication in another function THEN flag as **Medium**.
- **False Positive**: Values that are validated and bounded after storage before being used again.
- **Severity**: Medium
- **Fix**: Store high-precision numerator and denominator separately. Compute the ratio only at point of use. Never store intermediate division results as prices.

---

### [Rule ID: ML-ARI-005] Unchecked Bitwise Overflow

> **⚙️ Implementation: `REGEX`** — Pattern: `[^;]*<<[^;]*(?:balance|liquidity|price|amount|reserve)`


- **Pattern**: A bitwise shift (e.g., `<<`, `>>`) is performed on an integer type with no preceding bounds check. Move's standard mathematical operations (like `+`, `-`, `*`) automatically check for overflow, but bitwise shifts do not, leading to silent truncation/wrapping.
- **Real Case**: SlowMist auditing primer notes that bitwise operations in Move do not undergo overflow checks. An attacker can shift values on user inputs to overflow variables (like balances) silently without triggering a runtime abort.
- **Detection Logic**: IF a bitwise shift operator (`<<`, `>>`) is used on an integer type AND no explicit bounds or overflow checks precede it AND the result is used in critical logic (e.g., balance or price calculations) THEN flag as **High**.
- **False Positive**: Bitwise operations used on non-financial values, flags, or fixed masks.
- **Severity**: High
- **Fix**: Add explicit bounds assertions before executing shifts: e.g., `assert!(x < (1u64 << (64 - shift_amount)), EOverflow);` to ensure the operation cannot overflow.

---

### [Rule ID: ML-ARI-006] Protocol Fee Rounds to Zero for Small Amounts

> **⚙️ Implementation: `REGEX`** — Pattern: `\*\s*\w*[Ff]ee\w*\s*/\s*1(?:0{2,4})\b(?!.*assert!.*>\s*0)`


- **Pattern**: Calculating fees or interest using `fee = size * FEE_BPS / 10000` where integer division truncates the result to zero for small order sizes. This allows users to evade fees by splitting transactions into many small "dust" orders.
- **Real Case**: Zellic "Top 10 Aptos Move Bugs" (#5): DonkeySwap's protocol fee calculation rounded to zero for small amounts, which enabled users to perform fee-free swaps by executing large volumes of split dust transactions.
- **Detection Logic**: IF a fee or interest calculation uses integer multiplication followed by division AND does not enforce a minimum fee or order size THEN flag as **Medium**.
- **False Positive**: Systems that round up fee values or enforce minimum fee limits in transaction guards.
- **Severity**: Medium
- **Fix**: Require that computed fees are non-zero: e.g., `assert!(fee > 0 || size == 0, EFeeIsZero);` or round up division results.

---

### [Rule ID: ML-ARI-007] Cross-Chain Amount Precision Conversion Error

> **⚙️ Implementation: `REGEX`** — Pattern: `\*\s*10\s*\^\s*\([^)]*decimals[^)]*\)(?!.*(?:assert!.*!=\s*0|u256))`


- **Pattern**: Converting token amounts between chains with different decimal scales (e.g., `amount * 10^(dst_decimals - src_decimals)`) without validating that the conversion does not overflow or truncate to zero, leading to mismatching locked vs. minted balances.
- **Real Case**: MoveBit SuiBridge audit: Bridge operations rescaled token decimals between Ethereum (18 decimals) and Sui (9 decimals). Precision conversions lacked bounds checks, risking rounding errors or overflow mismatches in bridge transfers.
- **Detection Logic**: IF a bridge function rescales an amount by a decimal factor between different blockchains AND lacks overflow or minimum-output assertions THEN flag as **High**.
- **False Positive**: Bridge contracts operating exclusively on tokens with identical decimal scales.
- **Severity**: High
- **Fix**: Use wide intermediate integer types (e.g., `u256`), assert that the converted amount is non-zero, and implement strict reconciliation checks.

---

## SECTOR: Hot Potato / Flash Loan Misuse

### [Rule ID: ML-HOT-001] Hot Potato with Unintended Ability

> **⚙️ Implementation: `REGEX`** — Pattern: `struct\s+\w*(?:[Rr]eceipt|[Pp]otato|[Ll]oan|[Bb]orrow|[Ff]lash)\w*\s+has\s+[^{]*\b(?:drop|copy)\b`


- **Pattern**: A hot-potato struct (intended as a flash-loan receipt or lifecycle enforcer) accidentally declared with `drop` or `copy` ability. This breaks the entire lifecycle guarantee — the struct can be dropped without calling the repayment function, or copied to satisfy multiple repayment checks.
- **Real Case**: Mirage Audits (Oct 2025): "A hot potato with any abilities is a fundamental security flaw. The abilities are not metadata; they're the primary security mechanism. Adding `drop` to a hot potato doesn't generate a compiler error. It silently allows code that shouldn't compile to compile."
- **Detection Logic**: IF a struct is named `*Receipt`, `*Potato`, `*Loan`, `*Borrow*`, or `*Flash*` AND it has `has drop` or `has copy` in its ability set THEN flag as **Critical**.
- **False Positive**: None — a struct intended as a hot potato should never have `drop` or `copy`.
- **Severity**: Critical
- **Fix**: Define flash loan receipts as: `struct FlashReceipt { pool_id: ID, amount: u64 }` — no abilities listed. This forces the holder to pass it to a destruction function.

---

### [Rule ID: ML-HOT-002] Receipt Not Validated Against Source Object

> **⚙️ Implementation: `REGEX`** — Pattern: `fun\s+\w*(?:repay|return_loan|finish)\w*[^{]*\{(?!.*assert!.*(?:pool_id|source_id)\s*==\s*object::id)`


- **Pattern**: Hot potato receipt is validated only for existence (it must be consumed), but the receipt's embedded `pool_id` / `order_id` / `source_id` is never checked against the object passed to the repayment function. An attacker borrows from victim's object, then repays into their own object.
- **Real Case**: OpenZeppelin Sui audit findings (April 2026), from real audit of a Sui limit-order protocol (Lombard Finance / Navi Protocol class): Attacker calls `flash_loan(victimOrder)` → gets receipt with `order_id = victimOrder.id` → calls `repay(attackerOrder, receipt)` → no validation that receipt matches order → victim loses funds, attacker gains.
- **Detection Logic**: IF a repayment function accepts both a hot potato receipt and an object parameter AND the receipt contains an ID field AND there is no `assert!(receipt.source_id == object::id(param_object), EMismatch)` THEN flag as **Critical**.
- **False Positive**: Receipts that are designed to be cross-object (multi-hop flash loans where repayment to any matching pool is valid by design).
- **Severity**: Critical
- **Fix**: Store source object ID in receipt at loan creation: `FlashReceipt { pool_id: object::id(pool), amount }`. Assert on repayment: `assert!(receipt.pool_id == object::id(pool), EMismatchedOrder);`

---

### [Rule ID: ML-HOT-003] Flash Loan Price Oracle Manipulation

> **🔍 Implementation: `AST`** — Flash loan module + price oracle module both imported; oracle called within loan fn


- **Pattern**: AMM spot price used as oracle input within the same transaction as a flash loan. Attacker can borrow large amount, skew pool ratio/price, use skewed price in a dependent operation (collateral valuation, liquidation threshold), profit, then repay.
- **Real Case**: SlowMist auditing primer (2024) and Trail of Bits flash loan analysis (Sep 2025): "Never trust AMM spot prices for anything important. Attackers move them with flash loans." Pervasive in Solidity protocols, increasingly found in Sui DeFi via shared oracle modules.
- **Detection Logic**: IF a module imports both a flash-loan module AND a price oracle module AND calls oracle within the same function that initiates or is callable during a flash loan THEN flag as **High**.
- **False Positive**: TWAPs (time-weighted average prices) that cannot be manipulated in a single transaction by construction.
- **Severity**: High
- **Fix**: Use TWAP oracles for all financial decisions. If spot price must be used, add checks that the pool ratio has not deviated more than N% from a recent snapshot.

---

### [Rule ID: ML-HOT-004] Reentrance-Equivalent via Hot Potato Sequencing

> **⚙️ Implementation: `REGEX`** — Pattern: `fun\s+\w+[^{]*\{(?!.*(?:flash_loan_active|assert!.*!.*active)).*(?:swap|borrow|stake)\s*\(`


- **Pattern**: Protocol enters an "unusual" intermediate state when a flash loan is active (pool is imbalanced, collateral is temporarily zero), and other functions (swap, borrow, stake) can be called during this state because the hot potato only enforces repayment, not state invariants on intermediate calls.
- **Real Case**: Monethic workshop (Jan 2026): "The hot potato is a typical pattern to handle flash loans or atomic operations. During those, the protocol often is in a state that can be considered 'unusual.' It is common to implement prevention for calling other functions when pool is in imbalance."
- **Detection Logic**: IF a flash-loan function sets a state flag or creates a receipt AND other mutable protocol functions do not check for the flash-loan-active condition THEN flag as **High**.
- **False Positive**: Protocols where all functions are safe to call during a flash loan by invariant.
- **Severity**: High
- **Fix**: Add a `flash_loan_active: bool` field to the pool object, set to `true` on borrow, `false` on repay. Assert `!pool.flash_loan_active` in all other pool-mutating functions.

---

## SECTOR: Unsafe Upgrade Patterns

### [Rule ID: ML-UPG-001] UpgradeCap Not Validated Against Package

> **⚙️ Implementation: `REGEX`** — Pattern: `fun\s+\w+[^(]*\([^)]*UpgradeCap[^)]*\)(?!.*package::upgrade_package)`


- **Pattern**: A function that creates privileged objects (AdminCap, operator roles) accepts an `UpgradeCap` parameter as "proof of ownership" but never calls `package::upgrade_package(&cap)` to verify the cap belongs to the correct package. Any attacker who deploys a trivial package gets an `UpgradeCap` and can mint admin capabilities.
- **Real Case**: **Pawtato Protocol — OpenZeppelin Notorious Bug Digest #8 (April 2026)**: `create_new_admin_cap(upgrade_cap: UpgradeCap, recipient: address)` never validates which package the `UpgradeCap` belongs to. Attacker deploys a 2-line empty package, gets an `UpgradeCap`, calls `create_new_admin_cap` with it, mints `NewAdminCap` to themselves, achieves full protocol control. Exploit was a "cascade through Pawtato's capability delegation chain."
- **Detection Logic**: IF a function accepts `UpgradeCap` or `&UpgradeCap` as parameter AND does not call `package::upgrade_package(&cap)` to extract and validate the package ID THEN flag as **Critical**.
- **False Positive**: None — any function that uses `UpgradeCap` as auth proof must validate the cap's package ID.
- **Severity**: Critical
- **Fix**: Either (a) use a custom capability type `PawtatoAdminCap` defined in your own package — Move's type exclusivity guarantees no other package can create it — or (b) call `let pkg_id = package::upgrade_package(&upgrade_cap); assert!(pkg_id == @expected_package_addr, EWrongPackage);`.

---

### [Rule ID: ML-UPG-002] init Function Not Re-Run on Upgrade / State Migration Missing

> **🔍 Implementation: `AST`** — Package has new struct fields with no migrate() function defined


- **Pattern**: Package upgrade introduces new state fields or changes data invariants, but the `init` function (which runs once at publish time) is not re-run on upgrade. New fields remain at default zero values, and code that assumes non-zero defaults will behave incorrectly or fail.
- **Real Case**: Sui upgrade documentation (MystenLabs, 2022) and Three Sigma upgrade security blog: "Module Initializers are commonly used to perform operations that developers rely on happening exactly once per package. As such, they will not be re-run when a package is upgraded." AllianceBlock case: re-initialization attack by overwriting state.
- **Detection Logic**: IF a package upgrade (new `published-at` address) adds new struct fields or new shared objects AND no migration function is defined AND the new code reads these new fields without a null/zero guard THEN flag as **High**.
- **False Positive**: Upgrades that add only new functions, not new state.
- **Severity**: High
- **Fix**: Define an explicit `migrate(admin_cap: &AdminCap, ...)` function for the new version that initializes new fields. Gate it with `assert!(!migrated, EAlreadyMigrated)` and set a version sentinel after running.

---

### [Rule ID: ML-UPG-003] Old Package Version Still Callable — Invariant Violation

> **⏭️ Implementation: `SKIP_MVP`** — Requires on-chain multi-version cross-package analysis


- **Pattern**: After upgrading a package, the old version (immutable on-chain) remains callable. If the new version introduces invariants the old version is unaware of, an attacker calling old-version functions can violate those invariants.
- **Real Case**: Mysten Labs upgrade issue #2045 (2022): "Old versions of a package will still be callable, potentially accessing objects that are being used by newer versions. This can introduce bugs when the new version is maintaining invariants that the old version is completely unaware of."
- **Detection Logic**: IF a package has been upgraded (multiple versions exist on-chain) AND shared objects exist that both versions can mutate AND the new version added new field invariants THEN flag as **High** (requires cross-version analysis).
- **False Positive**: Upgrades that are strictly additive (new functions only, no changed shared state invariants).
- **Severity**: High
- **Fix**: Implement version gating on all shared objects: `assert!(pool.version == CURRENT_VERSION, EVersionMismatch)`. Bump `CURRENT_VERSION` constant in the new package. This causes all calls from old-version references to fail.

---

### [Rule ID: ML-UPG-004] Unrestricted UpgradeCap — No Upgrade Policy

> **⚙️ Implementation: `REGEX`** — Pattern: `UpgradeCap(?!.*(?:TimelockPolicy|DayOfWeekPolicy|multisig|timelock))`


- **Pattern**: `UpgradeCap` for a protocol with significant TVL is held in a plain address (not wrapped in a timelock or multisig upgrade policy object). A single compromised key can immediately push malicious code.
- **Real Case**: Documented in Mysten Labs upgrade security notes. Standard finding in every major Sui protocol audit.
- **Detection Logic**: IF `UpgradeCap` exists in a protocol contract AND it is not wrapped in a timelock/multisig policy object (e.g., `DayOfWeekPolicy`, `TimelockPolicy`) THEN flag as **Medium**.
- **False Positive**: Protocol explicitly choosing a mutable upgrade policy with documented justification.
- **Severity**: Medium
- **Fix**: Wrap `UpgradeCap` in a custom upgrade policy object that enforces timelock, multisig, or governance vote requirements before any upgrade proceeds.

---

## SECTOR: Race Conditions / Transaction Ordering

### [Rule ID: ML-RAC-001] Shared Object Front-Running via Validator Ordering

> **⏭️ Implementation: `SKIP_MVP`** — Requires semantic ordering-dependency analysis across transactions


- **Pattern**: Protocol action depends on being the first transaction in an epoch/block to interact with a shared object (e.g., claiming a first-mover reward, closing a position at a favorable price). Validators can order transactions within a checkpoint, allowing front-running.
- **Real Case**: Sui-specific property documented by SlowMist: Sui's parallel execution model means shared object transactions are ordered by validators within a consensus round. This is equivalent to Ethereum MEV for shared-object-dependent operations.
- **Detection Logic**: IF a function on a shared object produces materially different outcomes depending on whether it executes before or after another transaction that reads/writes the same shared object fields (e.g., price, liquidity) THEN flag as **Medium**.
- **False Positive**: Operations that are commutative (order doesn't change outcome).
- **Severity**: Medium
- **Fix**: Use commit-reveal schemes for price-sensitive operations. Use time-locked execution. For DEX swaps, enforce slippage tolerance: `assert!(actual_amount >= min_expected_amount, ESlippage)`.

---

### [Rule ID: ML-RAC-002] TOCTOU — Check-Then-Act on Shared Object State

> **🔍 Implementation: `AST`** — Shared field read, validated, then used without re-reading


- **Pattern**: Function reads a value from a shared object (the "check"), performs validation, then acts on a potentially stale value. Between the check and the act, another transaction may have modified the state.
- **Real Case**: Standard Sui shared-object concurrency issue. Documented in SlowMist primer and Monethic workshop as a class of bugs unique to Sui's parallelism model.
- **Detection Logic**: IF a function reads a shared object field, validates it against a threshold, then uses that field value in a calculation without re-reading it THEN flag as **Medium**.
- **False Positive**: Functions that execute atomically in a single PTB where no concurrent modification is possible.
- **Severity**: Medium
- **Fix**: Re-read the value from the object at point of use, not just at point of check. Use the re-read value for all subsequent calculations.

---

### [Rule ID: ML-RAC-003] Shared Object Contention — DoS via Blocking

> **⏭️ Implementation: `SKIP_MVP`** — Requires cross-transaction rate-limiting analysis


- **Pattern**: Critical protocol function requires exclusive access to a shared object, and an attacker can continuously submit transactions that acquire this access without completing their action, blocking legitimate users.
- **Real Case**: Monethic workshop and SlowMist primer both note this as a Sui-specific concern. Sui's parallel execution handles owned objects well but shared objects become serialization bottlenecks.
- **Detection Logic**: IF a high-frequency user function requires a `&mut SharedObject` AND there is no rate-limiting, cooldown, or per-user isolation THEN flag as **Low**.
- **False Positive**: Admin-only functions where contention from unprivileged users is impossible.
- **Severity**: Low
- **Fix**: Design shared objects to allow parallel reads. Minimize the critical section. Use per-user owned sub-objects for user state instead of one large shared object.

---

## SECTOR: Unchecked Return Values

### [Rule ID: ML-RET-001] Ignored Coin Operation Return Value

> **⚙️ Implementation: `REGEX`** — Pattern: `let\s+_\s*=\s*coin::(?:split|from_balance)|_\s*=\s*balance::split`


- **Pattern**: Call to `coin::split`, `balance::split`, `coin::from_balance`, or similar functions where the return value (the split-off coin/balance) is discarded using `_` or simply not bound to a variable, causing permanent loss of funds.
- **Real Case**: MoveScanner research paper (2025): Unchecked Return Value Detection is one of five core algorithms because "checking whether function call return values are properly handled, focusing on Boolean or non-empty returns" is essential. SlowMist primer: "In scenarios involving token consumption, special attention must be paid to token management and flow to prevent security issues or accidental losses."
- **Detection Logic**: IF `coin::split(...)`, `balance::split(...)`, `coin::from_balance(...)`, or any function returning `Coin<T>` or `Balance<T>` is called AND the return value is bound to `_` or not bound at all THEN flag as **Critical**.
- **False Positive**: None — dropping a coin/balance in Move is a compile error (resources cannot be dropped without explicit destruction). However, discarding via `_` may be possible in some contexts. Flag any `_` discard of a coin-typed return.
- **Severity**: Critical
- **Fix**: Always bind the returned coin/balance: `let remainder = coin::split(&mut coin, amount, ctx);`. Transfer or merge the remainder explicitly.

---

### [Rule ID: ML-RET-002] Error Code Swallowed — Boolean Return Ignored

> **⚙️ Implementation: `REGEX`** — Pattern: `let\s+\(\s*_\s*,\s*(?:[^)]+)\)\s*=\s*\w+\s*\(`


- **Pattern**: Function returns `(bool, T)` indicating success/failure with result. Caller uses only the result `T` (via tuple destructuring `let (_, result) = ...`) and ignores the boolean, proceeding even on failure.
- **Real Case**: OZ Notorious Bug Digest #8 (April 2026): "The `_` pattern, common across many languages, makes it easy to discard tuple elements, including critical error indicators, without any friction. When an early return zeroes out all outputs on failure, callers that only need a subset (like the remainder) silently receive wrong results." `div_rem_u256` function returns `(overflow_flag, quotient, remainder)` — callers that discard the flag proceed with wrong values.
- **Detection Logic**: IF a function call returns a tuple AND the first element (conventionally a status/bool) is bound to `_` AND the return type signature shows the first element is `bool` THEN flag as **High**.
- **False Positive**: Tuple destructuring where the discarded element is genuinely irrelevant (e.g., discarding the old value from a replace operation).
- **Severity**: High
- **Fix**: Never discard the first element of a tuple return from arithmetic/financial helper functions. `let (ok, result) = checked_div(a, b); assert!(ok, EOverflow);`.

---

### [Rule ID: ML-RET-003] Transfer Return Value Not Propagated

> **⚙️ Implementation: `REGEX`** — Pattern: `(?:option::unwrap_or|\.unwrap\(\))(?!.*assert!)`


- **Pattern**: Cross-module function call that internally performs a transfer or state mutation returns an error indicator. The outer function ignores this error and continues, leaving state inconsistent.
- **Real Case**: MoveBit SuiBridge vulnerability disclosure (Oct 2024): Missing Return Values from non-standard token contracts. Cross-chain bridge failed to validate ERC20-style transfer success codes.
- **Detection Logic**: IF a function calls an external module function that returns a status code or `Option<T>` AND the call result is not checked with `assert!` or `option::is_some` THEN flag as **Medium**.
- **False Positive**: Calls to functions that are documented as infallible.
- **Severity**: Medium
- **Fix**: Always propagate and check return values. Use `assert!(result.is_some(), EOperationFailed)` for `Option` returns.

---

### [Rule ID: ML-RET-004] Error or Overflow Flag Discarded While Using Zeroed Result

> **⚙️ Implementation: `REGEX`** — Pattern: `let\s+\(\s*_\s*,\s*(?:_\s*,\s*)?\w+\)\s*=\s*\w*(?:div|mul|math)\w*\s*\(`


- **Pattern**: Calling a helper function that returns `(error_flag, value)` (which returns a zeroed value on error) and discarding the error flag (using `_`), but continuing to process the zeroed value, leading to incorrect calculations.
- **Real Case**: OpenZeppelin Contracts-for-Sui math audit: The `div_rem_u256` function returned `(true, 0, 0)` on overflow. Callers that destructured the output like `let (_, _, remainder) = div_rem_u256(...)` ignored the overflow flag and used the zeroed remainder, silently corrupting math calculations.
- **Detection Logic**: IF a function returns a tuple containing a boolean error flag AND that flag is bound to `_` AND other returned fields are subsequently used in the code THEN flag as **High**.
- **False Positive**: Tuple destructuring where the discarded indicator is proven irrelevant by context.
- **Severity**: High
- **Fix**: Always assert that the error flag is false: `let (overflow, result) = safe_math_op(a, b); assert!(!overflow, EMathOverflow);`.

---

## SECTOR: Token / Coin Management

### [Rule ID: ML-TOK-001] Incorrect coin::split / balance::split Amount Validation

> **⚙️ Implementation: `REGEX`** — Pattern: `coin::split\s*\(&mut\s+\w+,\s*\w+(?!.*assert!.*(?:>=|value))`


- **Pattern**: Splitting a coin where the split amount is not validated against the coin's actual balance. If `amount > coin.balance`, Move aborts — but if validation allows `amount == 0` (dust attack), or if multiple splits can be composed to exceed balance, tokens are lost or incorrectly accounted.
- **Real Case**: Sui coin module docs: "Trying to split a coin more times than its balance allows." SlowMist primer: Token binding and circulation checks critical.
- **Detection Logic**: IF `coin::split(coin_ref, amount, ctx)` is called AND no preceding `assert!(coin::value(coin_ref) >= amount, EInsufficientBalance)` exists AND `amount` is derived from user input THEN flag as **High**.
- **False Positive**: Splits where Move's built-in abort on insufficient balance is sufficient protection.
- **Severity**: High
- **Fix**: Always validate: `assert!(amount > 0 && amount <= coin::value(&coin), EInvalidAmount)` before splitting.

---

### [Rule ID: ML-TOK-002] TreasuryCap Accessible to Untrusted Callers — Unlimited Mint

> **⚙️ Implementation: `REGEX`** — Pattern: `transfer::(?:public_)?share_object\s*\(\s*\w*[Tt]reasury[Cc]ap\w*|public\s+fun\s+\w+[^(]*\(&mut\s+TreasuryCap`


- **Pattern**: `TreasuryCap<T>` stored as a shared object or accessible via a public function that does not require admin capability. Any caller can mint unlimited tokens.
- **Real Case**: MWC taxonomy paper (2025, arxiv 2505.19047): "One of the identified vulnerabilities enables attackers to gain the ability to issue tokens." Standard Critical finding in Move token audits.
- **Detection Logic**: IF `TreasuryCap<T>` is stored with `transfer::share_object` OR if any `public fun` accepts `&mut TreasuryCap<T>` as parameter without a co-required `&AdminCap` THEN flag as **Critical**.
- **False Positive**: Managed minting protocols where `TreasuryCap` is correctly wrapped in a controlled minter object.
- **Severity**: Critical
- **Fix**: Keep `TreasuryCap` as an owned object held by a controlled address or wrapped in an `AdminCap`-gated minter object. Never share it.

---

### [Rule ID: ML-TOK-003] Nested Token Object Balance Leakage

> **🔍 Implementation: `AST`** — Struct has Coin<T>/Balance<T> field; destroy fn exists without extracting it


- **Pattern**: A `Coin<T>` or `Balance<T>` is stored inside another object (nested/wrapped). When the outer object is destroyed or transferred, the inner coin is not explicitly extracted and re-transferred, causing it to be locked forever.
- **Real Case**: SlowMist primer: "SUI allows objects to hold tokens, and token objects can be nested within other objects and split. Therefore, in scenarios involving token consumption, special attention must be paid to token management and circulation to avoid security issues or unexpected losses."
- **Detection Logic**: IF a struct has a field of type `Coin<T>` or `Balance<T>` AND a `destroy` or `delete` function exists for the struct AND the coin/balance field is not extracted before destruction THEN flag as **High**.
- **False Positive**: Structs where the coin field is always transferred before the struct is deleted.
- **Severity**: High
- **Fix**: In any `destroy`/`delete` function, always: `let remaining = object.coin; transfer::public_transfer(remaining, ctx.sender());` before destroying the wrapper.

---

### [Rule ID: ML-TOK-004] Over/Under-Payment Not Validated — Change Not Returned

> **⚙️ Implementation: `REGEX`** — Pattern: `fun\s+\w+[^(]*\([^)]*Coin<[^>]+>[^)]*\)(?!.*(?:assert!.*==\s*price|coin::split.*change))`


- **Pattern**: User deposits more than required for an operation (e.g., pays 100 SUI for a 50 SUI item). The extra is not returned as change. Or the exact payment is not validated, allowing underpayment.
- **Real Case**: Standard finding across all Sui marketplace/NFT audits. Monethic workshop mentions it as a recurring pattern.
- **Detection Logic**: IF a function accepts `Coin<T>` from user AND uses only a fixed portion of it AND does not call `coin::split` to return the remainder AND does not `assert!(coin::value(&payment) == exact_price, EWrongPayment)` THEN flag as **High**.
- **False Positive**: Functions that explicitly accept overpayment as a donation or fee by design.
- **Severity**: High
- **Fix**: Either validate exact payment: `assert!(coin::value(&payment) == price, EWrongPayment)` — or split and return change: `let change = coin::split(&mut payment, coin::value(&payment) - price, ctx); transfer::public_transfer(change, ctx.sender())`.

---

### [Rule ID: ML-TOK-005] Unfrozen Coin Metadata

> **⚙️ Implementation: `REGEX`** — Pattern: `coin::create_currency(?!(?:.|[\n])*transfer::public_freeze_object)`


- **Pattern**: Call to `coin::create_currency` returns a `CoinMetadata<T>` object which is subsequently shared via `transfer::public_share_object` or transferred, instead of being permanently frozen using `transfer::public_freeze_object`.
- **Real Case**: MoveBit reports cases where a protocol creates a new currency but leaves the returned `CoinMetadata` mutable or shared. This allows the treasury owner to alter the coin's name, symbol, icon, or description after deployment, creating user trust and front-running risks.
- **Detection Logic**: IF `coin::create_currency` is called AND the returned `CoinMetadata` variable is not frozen via `transfer::public_freeze_object` within the module THEN flag as **Medium**.
- **False Positive**: Protocols that explicitly intend to maintain mutable coin metadata for future upgrades (highly discouraged).
- **Severity**: Medium
- **Fix**: Always freeze the `CoinMetadata` object immediately after calling `create_currency`: `transfer::public_freeze_object(metadata);`.

---

### [Rule ID: ML-TOK-006] Vault First-Depositor Share Inflation via Direct Donation

> **⚙️ Implementation: `REGEX`** — Pattern: `shares\s*=\s*\w+\s*\*\s*total_shares\s*/\s*total_assets(?!.*(?:virtual|offset|minimum))`


- **Pattern**: A vault mints shares using `shares = deposit * total_shares / total_assets` without minimum-shares checking or virtual liquidity offsets. An attacker deposits 1 MIST for 1 share, then directly transfers a large asset balance to the vault, inflating the share price and truncating subsequent depositors' share counts to zero.
- **Real Case**: Bluefin audit by MoveBit: An attacker deposited 1 MIST to receive 1 share, then transferred 1 SUI directly to the vault. A subsequent depositor's 2 SUI deposit truncated to 1 share, allowing the attacker to withdraw a significant portion of the victim's funds.
- **Detection Logic**: IF a share calculation is performed as `deposit * total_shares / total_assets` AND there is a path to increase `total_assets` via direct transfer without minting shares AND no virtual liquidity offset is used THEN flag as **High**.
- **False Positive**: Vaults with initial liquidity locks or virtual-offset math that prevents share dilution.
- **Severity**: High
- **Fix**: Require a minimum shares output on deposits, seed initial dead shares at deployment, or use virtual offsets for share pricing.

---

### [Rule ID: ML-TOK-007] Unauthorized Fee Deposit to Arbitrary Partner Account

> **⚙️ Implementation: `REGEX`** — Pattern: `fun\s+\w*(?:deposit|add)_fee\w*[^(]*\([^)]*partner[^)]*\)(?!.*(?:assert!.*sender|AdminCap))`


- **Pattern**: A partner fee deposit function allows any caller to specify an arbitrary partner address or account ID, which can lead to accounting inflation or fee-allocation manipulation if caller permission is not verified.
- **Real Case**: Cetus Sui audit by MoveBit: A function allowed any caller to deposit fees into any partner account. Although characterized as "deposits only," the lack of caller authorization enabled manipulation of fee records.
- **Detection Logic**: IF a function updates a partner or user balance keyed by a caller-supplied address AND has no caller capability or sender validation THEN flag as **Medium**.
- **False Positive**: Permissionless tip/donation functions where deposit targets are unrestricted by design.
- **Severity**: Medium
- **Fix**: Require that the partner address matches a verified registry or capability: `assert!(tx_context::sender(ctx) == partner_address, EUnauthorized);`.

---

### [Rule ID: ML-TOK-008] Missing coin::is_account_registered check before Deposit

> **⚙️ Implementation: `REGEX`** — Pattern: `coin::(?:deposit|transfer)\s*\([^)]*\)(?!.*is_account_registered)`


- **Pattern**: Performing a coin deposit or transfer to an account without validating if the recipient is registered to receive the coin type, leading to unexpected transaction aborts.
- **Real Case**: Zellic "Top 10 Aptos Move Bugs" (#6): DonkeySwap's limit order execution transferred quote coins to the recipient without checking if their `CoinStore` was registered, enabling attackers to block public liquidity queues by targeting unregistered accounts.
- **Detection Logic**: IF `coin::deposit` or `coin::transfer` is executed to a user address AND there is no `coin::is_account_registered` check preceding it THEN flag as **Medium**.
- **False Positive**: Transfers using the recipient's direct transaction signer (which registers automatically).
- **Severity**: Medium
- **Fix**: Check that the account is registered: `if (!coin::is_account_registered<CoinType>(recipient)) { coin::register<CoinType>(recipient); };`.

---

## SECTOR: Object Wrapping / Unwrapping

### [Rule ID: ML-WRP-001] Permanent Asset Lock via freeze_object on Wrapper

> **⚙️ Implementation: `REGEX`** — Pattern: `transfer::(?:public_)?freeze_object\s*\(\s*\w+\s*\)(?!.*\.inner\s*=)`


- **Pattern**: `transfer::public_freeze_object(wrapper)` called on an object that contains (wraps) other objects in its fields. The inner objects can never be unwrapped because the outer object is immutable.
- **Real Case**: Sui linter warning W04001 (Nov 2023): "Freezing an object of type `Wrapper` also freezes all objects wrapped in its field `inner`. Freezing such objects prevents unwrapping of inner objects." Zellic "Move Fast & Break Things Part 2" (Dec 2022) first documented object hiding in this context.
- **Detection Logic**: IF `transfer::public_freeze_object(T)` or `transfer::freeze_object(T)` is called AND struct `T` has a field of any type with `key` ability THEN flag as **High**.
- **False Positive**: Intentional freezing of a wrapper where inner objects are intended to be permanently immutable (e.g., a sealed certificate).
- **Severity**: High
- **Fix**: Before freezing a wrapper, extract all inner objects with `key` ability: `let inner = wrapper.inner; transfer::public_transfer(inner, ctx.sender()); transfer::public_freeze_object(wrapper)`.

---

### [Rule ID: ML-WRP-002] No Unwrap Path — Permanently Locked Wrapped Object

> **🔍 Implementation: `AST`** — Outer struct has key-ability inner field; no fn returns/transfers that inner


- **Pattern**: An object is wrapped inside another object (stored as a field, not via `dynamic_field`), but no function exists to unwrap it. The inner object can never be recovered.
- **Real Case**: Zellic Part 2 and Sui upgrade docs: "The object isn't directly accessible on-chain. The object is stored in another wrapper object. To recover the original object, you must destroy the wrapper object (unwrapping)."
- **Detection Logic**: IF struct `Outer` has a field of type `Inner` where `Inner has key` AND no function in the module takes `Outer` by value and returns `Inner` (or transfers it) THEN flag as **High**.
- **False Positive**: Objects intentionally locked forever (NFT in a vault that requires a governance action to unlock, where that governance function exists).
- **Severity**: High
- **Fix**: Always define a corresponding `unwrap` function for any `wrap` function. Ensure it has appropriate access control.

---

### [Rule ID: ML-WRP-003] Wrap Without drop / store Ability — Compiler Trap

> **🔍 Implementation: `AST`** — Struct field type has key ability but lacks store ability


- **Pattern**: Wrapping an object that does not have `store` ability into a parent object. Move requires inner objects to have `store` to be stored in another object's field. This can cause code to fail in unexpected ways or be patched around via dynamic fields, introducing new bugs.
- **Real Case**: Standard Move type system requirement, commonly tripped when migrating EVM logic to Sui.
- **Detection Logic**: IF a struct field has type `T` where `T` has `key` but not `store` THEN flag as **Medium** (will be caught by compiler, but important to surface explicitly for auditors).
- **False Positive**: None — this is a hard compiler constraint.
- **Severity**: Medium (Compiler-Enforced, but surfaced for auditor attention)
- **Fix**: Add `store` ability to inner type if wrapping is intended: `struct Inner has key, store { id: UID, ... }`.

---

## SECTOR: Denial of Service

### [Rule ID: ML-DOS-001] Unbounded Loop over User-Controlled Collection

> **⚙️ Implementation: `REGEX`** — Pattern: `(?:while|vector::for_each|loop)\s*[({](?!.*(?:MAX_SIZE|max_size|assert!.*length))`


- **Pattern**: Function iterates over a `vector` or `Table` that users can append to without bound. As collection grows, the gas cost of iteration grows unboundedly, eventually exceeding the transaction gas limit and making the function permanently uncallable.
- **Real Case**: Monethic workshop (Jan 2026): "User can control a storage/data collection that is processed in full every time it is processed (e.g., processing whole leaderboard to distribute rewards). A variant was seen where a contract accounts for dozens of coin types but always iterates over all available balances during a key operation."
- **Detection Logic**: IF `while` loop or `vector::for_each` iterates over a collection that is appended to by user-callable functions AND there is no maximum size cap on the collection THEN flag as **High**.
- **False Positive**: Collections that are administratively bounded (only admin can add entries, with a known-small maximum).
- **Severity**: High
- **Fix**: Cap collection size: `assert!(vector::length(&collection) < MAX_SIZE, ECollectionFull)`. Process in batches. Use pagination patterns for large datasets.

---

### [Rule ID: ML-DOS-002] Shared Object Starvation Attack

> **⏭️ Implementation: `SKIP_MVP`** — Requires shared-object contention and transaction-frequency analysis


- **Pattern**: Critical protocol function requires exclusive write access to a single shared object. An attacker submits a continuous flood of low-value transactions targeting that object, filling the consensus queue and starving legitimate users.
- **Real Case**: Sui DoS audit by Halborn: "Halborn conducted a DoS security audit to identify if there was any risk of DoS conditions on nodes that may result from custom transactions." Specific to Sui's shared-object serialization model.
- **Detection Logic**: IF a shared object is the bottleneck for a high-frequency user-facing operation AND there are no rate limits or per-user sub-objects THEN flag as **Medium**.
- **False Positive**: Low-TVL or low-frequency protocols where DoS is economically infeasible.
- **Severity**: Medium
- **Fix**: Minimize shared state. Use per-user owned objects. Implement per-user cooldowns stored in owned objects (not shared). Use event-based patterns where possible.

---

### [Rule ID: ML-DOS-003] Resource Exhaustion via Repeated Object Creation

> **⏭️ Implementation: `SKIP_MVP`** — Requires per-user object creation count analysis


- **Pattern**: User can trigger creation of unbounded on-chain objects (dynamic fields, wrapped objects, etc.) in a loop or via repeated calls, exhausting the protocol's storage deposit or creating unbounded indexer load.
- **Real Case**: Standard Sui protocol concern. Monethic workshop: "There is no method to clear items from storage/data collection and they accumulate over time or can be arbitrarily populated by user."
- **Detection Logic**: IF a user-callable function creates new objects or dynamic fields in a loop OR if there is no limit on how many times a user can call an object-creating function THEN flag as **Low**.
- **False Positive**: Protocols with per-user fees that make spam economically infeasible.
- **Severity**: Low
- **Fix**: Charge a storage deposit per object created. Enforce a maximum number of objects per user address. Implement a `delete` path that returns the storage deposit.

---

### [Rule ID: ML-DOS-004] DoS via table::add on Recurrent User-Controlled Key

> **⚙️ Implementation: `REGEX`** — Pattern: `table::add\s*\(&mut\s+\w+,\s*(?:ctx\.sender\(\)|sender|\w+_address)(?!.*(?:contains|borrow_mut))`


- **Pattern**: Using `table::add(t, key, val)` or `dynamic_field::add` on keys that can recur (such as a sender's address) without checking if the key already exists. A duplicate key will cause a transaction abort, creating a permanent Denial of Service (DoS) for the user.
- **Real Case**: Monethic Sui Move workshop: A banking module's deposit function always used `table::add(&mut bank.balances, sender, amount)`. A user's second deposit aborted due to a duplicate key, trapping their deposit forever.
- **Detection Logic**: IF `table::add` or `dynamic_field::add` is called with a user-controlled key AND there is no `contains` check or fallback to `borrow_mut`/`upsert` THEN flag as **Medium**.
- **False Positive**: Keys that are cryptographically guaranteed to be unique on each call (e.g., newly minted object IDs).
- **Severity**: Medium
- **Fix**: Use insert-or-update patterns: `if (table::contains(t, key)) { *table::borrow_mut(t, key) = new_val; } else { table::add(t, key, new_val); };` or use `table::upsert`.

---

## SECTOR: External Module / Dependency Security

### [Rule ID: ML-EXT-001] Trusting Unvalidated External Library Math

> **⚙️ Implementation: `REGEX`** — Pattern: `use\s+(?!sui::|std::)\w+::\w+(?!.*(?:Move\.lock|pinned|rev\s*=))`


- **Pattern**: Core financial calculations delegated to an external open-source library without auditing the library's implementation. The library may have bugs that survive audits of the main protocol (auditors assume the library is safe).
- **Real Case**: **Cetus Protocol (May 2025)**: `integer-mate` library's `checked_shlw` bug survived three separate audits (OtterSec, MoveBit, Zellic) because "auditors assumed 'everyone uses this, it must be safe.'" Mirage Audits (Oct 2025): "The bug was in integer-mate, a widely-used open-source library. Auditors assumed 'everyone uses this, it must be safe.'"
- **Detection Logic**: IF the module imports a third-party library (non-`sui::*`, non-`std::*`) AND uses it in functions that handle balances, liquidity, or prices AND the library version is not pinned in `Move.lock` THEN flag as **High**.
- **False Positive**: Libraries that have been independently formally verified.
- **Severity**: High
- **Fix**: Audit all math library dependencies line-by-line. Pin dependency versions in `Move.lock`. Write property-based fuzz tests for all imported math functions at boundary values. Never assume community library correctness.

---

### [Rule ID: ML-EXT-002] Dependency Not Updated After External Package Upgrade

> **⚙️ Implementation: `REGEX`** — Pattern: `git\s*=\s*"[^"]+"[^}]*branch\s*=`


- **Pattern**: Protocol depends on `PackageA@v1`. `PackageA` is upgraded to `v2` (fixing a bug or adding invariants). The dependent protocol still uses `v1` — it gets no upgrade notification automatically and continues calling potentially broken/insecure functions.
- **Real Case**: Sui upgrade documentation: "If you have a package with a dependency, and that dependency is upgraded, your package does not automatically depend on the newer version. You must explicitly upgrade your own package to point to the new dependency." Cetus: The `integer-mate` fix was applied, but any protocol that depended on the unfixed version remained vulnerable.
- **Detection Logic**: IF a dependency in `Move.toml` references a package by git branch (not a pinned commit or published address) THEN flag as **Medium**.
- **False Positive**: Packages in active development that intentionally track a branch.
- **Severity**: Medium
- **Fix**: Pin all dependencies to specific commit hashes or published package addresses in `Move.toml`. Subscribe to security advisories for all dependencies. Have a documented upgrade procedure for dependency updates.

---

### [Rule ID: ML-EXT-003] Cross-Module Invariant Violation via Stale Object Version

> **⏭️ Implementation: `SKIP_MVP`** — Requires on-chain multi-version struct invariant comparison


- **Pattern**: Two modules share a struct type. Module A upgrades and adds a new invariant to the struct. Module B still calls Module A at an older version and creates struct instances that violate Module A v2's new invariant, causing silent corruption when Module A v2 processes them.
- **Real Case**: Mysten Labs upgrade issue #2045: "This can introduce bugs when the new version is maintaining invariants that the old version is completely unaware of."
- **Detection Logic**: IF module imports a package and calls functions that return or mutate a struct defined in that package AND the package has multiple published versions on-chain THEN flag as **Medium** (requires on-chain version analysis).
- **False Positive**: Upgrades that are strictly additive with no new struct invariants.
- **Severity**: Medium
- **Fix**: Implement version gating in all shared structs: `assert!(obj.version == CURRENT_VERSION, EStaleVersion)`. Refuse to process structs created by old module versions.

---

### [Rule ID: ML-EXT-004] Orphaned Friend Module Relationship

> **⚙️ Implementation: `REGEX`** — Pattern: `friend\s+\w+::\w+(?!.*same_package)`


- **Pattern**: Module declares `friend module_b` giving module_b access to `public(friend)` functions, but module_b has been removed, replaced, or is in a different trust domain. An attacker who can publish as module_b (e.g., at the same address) gains privileged access.
- **Real Case**: OpenZeppelin Sui audit findings class: "Friend module overexposure: unintended access to private logic."
- **Detection Logic**: IF a module has `friend` declarations AND the friend module is not in the same package AND the friend module's address is not the deployer's controlled address THEN flag as **Medium**.
- **False Positive**: Friend relationships within the same package (same `Move.toml`).
- **Severity**: Medium
- **Fix**: Prefer `public(package)` over `public(friend)` for intra-package access. For cross-package trust, use capability-passing instead of friend declarations.

---

## SECTOR: Design Logic Flaws

### [Rule ID: ML-LOG-001] State Machine Invalid Transition

> **⚙️ Implementation: `REGEX`** — Pattern: `fun\s+\w+[^{]*\{(?!.*assert!.*(?:status|state)\s*==).*(?:status|state)\s*=`


- **Pattern**: Protocol has explicit states (e.g., `PENDING`, `ACTIVE`, `SETTLED`, `CLOSED`) stored in a field, but transition functions do not assert the required prior state, allowing transitions like `PENDING → CLOSED` (skipping `ACTIVE`) or calling settlement functions on already-closed positions.
- **Real Case**: Standard finding in Sui DeFi lending/derivative audits. MoveBit deep-dive 2024: "Logic errors and edge cases" are a primary finding category. State machine bugs are the dominant sub-type.
- **Detection Logic**: IF a module defines status/state constants (`const STATUS_PENDING: u8 = 0`, etc.) AND a function that transitions state does not assert the current state is a valid predecessor THEN flag as **High**.
- **False Positive**: Functions explicitly designed to work from multiple states.
- **Severity**: High
- **Fix**: Every state-transition function must assert: `assert!(obj.status == EXPECTED_PRIOR_STATE, EInvalidTransition)`. Document the valid state graph in comments.

---

### [Rule ID: ML-LOG-002] Missing Global Invariant After Multi-Step Operation

> **🔍 Implementation: `AST`** — Function modifies multiple invariant fields with asserts interleaved between mutations


- **Pattern**: A complex operation (multi-function flow across a PTB) modifies several protocol invariants incrementally. If the transaction fails mid-way, some invariants are updated and others are not, leaving the protocol in an inconsistent state. In Move/Sui, transaction atomicity prevents partial execution — but PTB-level attacks that succeed on step N and fail on step N+1 for other victims can still produce cross-user inconsistencies.
- **Real Case**: OZ Notorious Bug Digest #8 (April 2026): "Auditing internal helper functions in isolation is not enough; the contract between caller and callee must be verified. Neither function was buggy alone. The bug only emerges at the boundary."
- **Detection Logic**: IF a function modifies multiple related fields (e.g., `total_supply` AND `user_balance` AND `reserve_factor`) AND at least one modification could be skipped if an assert fails between them THEN flag as **Medium**.
- **False Positive**: Move's transaction atomicity handles most of this — if any assert fails, the whole tx reverts. Only flag patterns where the logic could succeed with a partial update due to incorrect ordering of checks and effects.
- **Severity**: Medium
- **Fix**: Apply checks-effects pattern: all asserts first, all mutations after. Group invariant-maintaining mutations together with no asserts between them.

---

### [Rule ID: ML-LOG-003] Reentrancy-Equivalent via Callback / Dynamic Dispatch

> **🔍 Implementation: `AST`** — Non-phantom generic T param with destructor or method call in fn body


- **Pattern**: While Move prevents classical reentrancy (no callbacks on token transfer), a protocol that uses generic type parameters with user-supplied types can be tricked into calling attacker code mid-execution. An attacker supplies a type with a custom `drop` implementation that executes during resource cleanup.
- **Real Case**: Move by Example (Aptos, 2023): "Move's resource model ensures that a resource can only be accessed by a single execution context at a time." However, generic-type confusion bugs can create reentrancy-equivalent effects documented in the MWC taxonomy paper.
- **Detection Logic**: IF a function accepts a generic type parameter `T` AND calls any method on `T` (or destructs `T`) that could invoke user-defined logic THEN flag as **Medium**.
- **False Positive**: Phantom type parameters (`phantom T`) — these cannot carry user-defined behavior.
- **Severity**: Medium
- **Fix**: Use phantom type parameters when `T` is only used for type safety (not behavior). When `T` must be destructed, ensure the destruction is a simple drop of copyable/droppable values, not a callback.

---

### [Rule ID: ML-LOG-004] Time Unit Confusion — Milliseconds vs Seconds vs Epochs

> **⚙️ Implementation: `REGEX`** — Pattern: `(?:expires_at|deadline|expiry|end_time)\s*(?:!=|<|>|==)\s*clock::timestamp_ms(?!.*_ms\b)`


- **Pattern**: Time comparison uses wrong unit. E.g., `expiry_timestamp_ms < clock::timestamp_ms(clock)` correctly checks milliseconds, but if `expiry_timestamp_ms` was set using seconds (`block_time * 1000` missing), deadlines are 1000x too short. Or comparing epoch-based timestamps to clock-based timestamps.
- **Real Case**: Monethic workshop (Jan 2026): "The vulnerability is straightforward, but it was also seen multiple times on multiple ecosystems. In other words, this is a human mistake when handling time units."
- **Detection Logic**: IF a timestamp comparison involves `clock::timestamp_ms` AND the stored timestamp value was computed from an input that was not explicitly multiplied by 1000 (or if the input is described as "seconds" in comments) THEN flag as **High**.
- **False Positive**: Code that correctly documents its time unit and uses consistent units throughout.
- **Severity**: High
- **Fix**: Establish a single time convention (always milliseconds in Sui since `clock::timestamp_ms` returns ms). Suffix all timestamp variables with `_ms`: `expires_at_ms`. Add inline assertions: `assert!(expires_at_ms > 1_000_000_000_000, ETimestampLooksLikeSeconds)`.

---

### [Rule ID: ML-LOG-005] Invariant Violation via Composable PTB — Cross-Function Attack

> **⏭️ Implementation: `SKIP_MVP`** — Requires inter-procedural PTB composition analysis


- **Pattern**: Two functions A and B are each individually safe, but when called in sequence within a single PTB with shared state, function A sets up conditions that allow B to produce an incorrect result. Neither auditor reviewing A or B in isolation would find the bug.
- **Real Case**: OZ Notorious Bug Digest #8 (April 2026) — the `mul_mod_impl` / `div_rem_u256` boundary: "The `_` pattern... one function zeroes the remainder on overflow, the other discards the overflow flag. Auditing internal helper functions in isolation is not enough." DeepBook PTB-based flash loan attack vectors per Trail of Bits (Sep 2025).
- **Detection Logic**: IF two public functions both modify the same shared object AND function A produces an intermediate state that function B does not validate THEN flag as **Medium** (requires inter-procedural analysis).
- **False Positive**: Functions explicitly designed to be composed and documented with pre/post conditions.
- **Severity**: Medium
- **Fix**: Document pre/post conditions for every state-mutating function. Add entry-condition assertions to sensitive functions even if they "should only be called after" a setup function.

---

### [Rule ID: ML-LOG-006] One-Time Witness (OTW) Misuse — Multiple Publisher Claims

> **⚙️ Implementation: `REGEX`** — Pattern: `package::claim\s*<[^>]+>\s*\([^)]+\)(?!.*ctx\.sender\(\)).*transfer::`


- **Pattern**: A module's one-time witness type is used to claim multiple `Publisher` objects (one per module possible by design), or the OTW is transferred to untrusted parties who then claim Publisher privileges.
- **Real Case**: Sui package documentation: "Due to this constraint there can be only one `Publisher` object per module but multiple per package." If a package has multiple modules, each can claim its own `Publisher`, potentially with different trust levels.
- **Detection Logic**: IF `package::claim<OTW>(otw, ctx)` is called AND the resulting `Publisher` is transferred to an address that is not `ctx.sender()` (the deployer) AND there is no admin cap check THEN flag as **High**.
- **False Positive**: Protocols that deliberately distribute Publisher objects to trusted governance addresses.
- **Severity**: High
- **Fix**: Always transfer `Publisher` to a controlled admin address in `init`. Never allow external callers to trigger `Publisher` creation via a public function.

---

### [Rule ID: ML-LOG-007] Pointer Reassignment Bug

> **⚙️ Implementation: `REGEX`** — Pattern: `let\s+(\w+)\s*=\s*&mut\s+\w+\.\w+;[^;]*\n[^;]*\1\s*=\s*\w+;(?!.*\*\1\s*=)`


- **Pattern**: Destructuring a mutable reference (like `&mut Struct`) into fields binds them as `&mut` references. Assigning one such field reference to another (e.g., `left = limit`) without using the dereference operator `*` reassigns the local pointer rather than copying the value, silently leading to incorrect state updates.
- **Real Case**: Lombard Finance audit by OpenZeppelin (April 2026) identified a pointer reassignment bug where `left = limit;` was written instead of `*left = *limit;`. As a result, the `left` pointer pointed to the `limit` data, and the subsequent subtraction decremented `limit` instead of `left`, silently corrupting state transitions.
- **Detection Logic**: IF a local reference variable (e.g., destructured `&mut` field) is assigned to another reference variable AND neither side uses `*` to perform value dereferencing THEN flag as **Critical**.
- **False Positive**: Reassigning non-reference local variables or updating references in loop cursors where value copying is not intended.
- **Severity**: Critical
- **Fix**: Use the dereference operator `*` on both sides of the assignment to copy the value: e.g., `*left = *limit;`.

---

### [Rule ID: ML-LOG-008] Generic Type Parameter Not Validated Against User-Supplied Index

> **⚙️ Implementation: `REGEX`** — Pattern: `fun\s+\w+<[A-Z]\w*>[^(]*\([^)]*\w+:\s*u(?:64|8|32|16|128|256)[^)]*\)(?!.*(?:type_name::get|coin_type))`


- **Pattern**: A function takes both a generic type parameter `Pool<CoinType>` and a separate scalar index/discriminator used to fetch asset config, but never validates that the index corresponds to `CoinType`, enabling users to swap or withdraw mismatching assets.
- **Real Case**: Navi Protocol audit by OpenZeppelin: `withdraw` accepted a `BTC` pool parameter but a user-supplied index for `USDC`. The protocol recorded a USDC withdrawal but paid out BTC from the pool, enabling direct asset theft.
- **Detection Logic**: IF a function has a generic type parameter `T` AND accepts a user-supplied index/discriminator to look up config state AND does not validate that `type_name::get<T>()` matches the state's registered type THEN flag as **Critical**.
- **False Positive**: Functions where the index is derived directly from the type on-chain rather than supplied by the user.
- **Severity**: Critical
- **Fix**: Validate type equality: `assert!(type_name::get<T>() == config.coin_type, ETypeMismatch);`.

---

### [Rule ID: ML-LOG-009] Paired Object Not Bound by Stored ID

> **⚙️ Implementation: `REGEX`** — Pattern: `fun\s+\w+[^(]*\(\s*\w+\s*:\s*&\w+\s*,\s*\w+\s*:\s*&\w+[^)]*\)(?!.*assert!.*pool_id\s*==\s*object::id)`


- **Pattern**: Operating on two generic objects (e.g., `Position` and `SupplyPool`) without verifying that the position was created against that specific pool instance, enabling users to settle or liquidate positions against the wrong pools.
- **Real Case**: Kuna Labs audit by OpenZeppelin: A position opened against `SupplyPoolA` was liquidated using `SupplyPoolB`. Since the user owed no debt in `SupplyPoolB`, the liquidator claimed the position's collateral for free without reducing any real debt.
- **Detection Logic**: IF a function operates on two related objects A and B AND object A's struct does not validate object B's ID (`assert!(A.pool_id == object::id(B), EMismatch)`) THEN flag as **High**.
- **False Positive**: Systems with only one canonical pool instance where cross-pool mismatches are impossible.
- **Severity**: High
- **Fix**: Store the associated pool ID in the position object at creation, and assert identity matches on liquidation/settlement: `assert!(position.pool_id == object::id(pool), EPoolMismatch);`.

---

### [Rule ID: ML-LOG-010] Wrong Standard-Library Function Causes Runtime Abort

> **⚙️ Implementation: `REGEX`** — Pattern: `option::borrow\s*\(&\s*\w+\s*\)(?!.*option::is_some).*option::extract`


- **Pattern**: Misusing near-identical standard library helper functions (e.g., calling `option::borrow` on an `Option` that was just emptied via `option::extract`, or using `table::add` where keys might repeat), causing runtime aborts.
- **Real Case**: Zellic "Top 10 Aptos Move Bugs" (#10): DonkeySwap's order fulfillment borrowed from an `Option` after extracting its value, aborting successful order matches and blocking liquidity addition.
- **Detection Logic**: IF a module calls `option::borrow` or `option::borrow_mut` on an `Option` variable after a reachable `option::extract` call without re-populating it THEN flag as **Medium**.
- **False Positive**: Cases where code paths prevent execution of the borrow after extraction.
- **Severity**: Medium
- **Fix**: Extract the value once and reuse the local variable, or perform the borrow first before extraction.

---

### [Rule ID: ML-LOG-011] Randomness-Dependent Branch with Outcome-Dependent Gas

> **⚙️ Implementation: `REGEX`** — Pattern: `(?:random::new_generator|RandomGenerator)[^;]*;.*if\s*\([^)]*rand[^)]*\)(?!.*gas_equal)`


- **Pattern**: Consuming on-chain randomness and executing outcome branches that have different gas costs. An attacker can set a precise transaction gas budget so that unfavorable (more expensive) branches abort, retrying until they win.
- **Real Case**: Aptos AIP-41 Undergasing Attack: Attackers bias random outcomes in lotteries or mints by setting gas limits such that the "lose" path aborts and reverts the transaction, allowing them to retry only on "win" paths. Sui randomness guidelines warn of similar PTB gas-budget exploits.
- **Detection Logic**: IF a function consumes randomness (from `Random` or `RandomGenerator`) AND branches on the outcome AND the branches have significantly different gas requirements (e.g., one branch performs object creation or transfer while the other does not) THEN flag as **Critical**.
- **False Positive**: Random draws that only store the result to be processed in a separate transaction later.
- **Severity**: Critical
- **Fix**: Make all outcome branches gas-equal, or save the random outcome to storage and execute the effects in a separate, subsequent transaction.

---

### [Rule ID: ML-LOG-012] Randomness-Consuming Function Declared public Instead of entry

> **⚙️ Implementation: `REGEX`** — Pattern: `public\s+fun\s+\w+[^(]*\([^)]*(?:Random|RandomGenerator)[^)]*\)`


- **Pattern**: Exposing a public function that consumes on-chain randomness. Public functions can be composed with other smart contracts in a single PTB, allowing attackers to check outcomes and abort transactions if they lose.
- **Real Case**: Sui and Aptos randomness guidelines: Randomness-consuming functions must be declared as `entry` (or private/friend with `#[randomness]` annotation in Aptos) to prevent composition attacks.
- **Detection Logic**: IF a function reads randomness AND is declared `public` or `public entry` THEN flag as **High**.
- **False Positive**: Randomness helpers that are private or restricted to package-only access.
- **Severity**: High
- **Fix**: Declare randomness-consuming functions as `entry` to block PTB composition, and avoid returning random outcomes to public callers.

---

### [Rule ID: ML-LOG-013] RandomGenerator Passed as Function Argument

> **⚙️ Implementation: `REGEX`** — Pattern: `fun\s+\w+[^(]*\([^)]*RandomGenerator[^)]*\)`


- **Pattern**: Creating a `RandomGenerator` in one function and passing it as an argument to another function, exposing its internal state to prediction via byte serialization.
- **Real Case**: Sui `random.move` security guidelines: "RandomGenerator is secure as long as it is created by the consuming module. If passed as an argument, the caller might be able to predict the outputs." The compiler automatically rejects public functions with `RandomGenerator` arguments.
- **Detection Logic**: IF a `RandomGenerator` is passed as a function parameter rather than created locally within the function THEN flag as **High**.
- **False Positive**: Internal helper functions within the same module where state is not user-observable.
- **Severity**: High
- **Fix**: Pass only `&Random` as a parameter and construct the `RandomGenerator` locally inside the function using `random::new_generator`.

---

### [Rule ID: ML-LOG-014] Missing Pool-Pause or Suspended State Check

> **⚙️ Implementation: `REGEX`** — Pattern: `fun\s+\w*(?:swap|add_liquidity|trade)\w*[^{]*\{(?!.*assert!.*!.*paused)`


- **Pattern**: Swap or liquidity-adding functions that fail to check the pool's paused or suspended state flag, allowing trading to continue during emergency halts.
- **Real Case**: Cetus SUI audit: The swap entry point failed to check if the liquidity pool was suspended, allowing users to continue swapping tokens when the pool was supposed to be halted.
- **Detection Logic**: IF a pool struct contains a pause/status field AND a swap/liquidity function does not assert that the pool is active THEN flag as **Medium**.
- **False Positive**: Pools designed without administrative emergency-stop mechanisms.
- **Severity**: Medium
- **Fix**: Always verify the pool's status at the beginning of trade operations: `assert!(!pool.paused, EPoolPaused);`.

---

### [Rule ID: ML-LOG-015] Event Emitted on Attacker-Controlled Path or Missing Event

> **🔍 Implementation: `AST`** — event::emit with attacker-controlled fields, or state-changing fn lacks event::emit


- **Pattern**: Emitting a critical accounting event from a public path with attacker-controlled fields, or failing to emit an event on a major state change, causing off-chain indexers to lose synchronization.
- **Real Case**: MoveBit SuiBridge analysis: Relayers and validators rely on emitted events for cross-chain processing. Emitting events on unvalidated paths or failing to emit them on state updates results in off-chain accounting discrepancies.
- **Detection Logic**: IF an event is emitted from an unauthorized public function using caller-controlled inputs OR if a state-changing operation lacks an event emission THEN flag as **Medium**.
- **False Positive**: Informational events that do not affect financial or authorization status.
- **Severity**: Medium
- **Fix**: Enforce caller checks before emitting events, and ensure every state mutation triggers an event emission.

---

### [Rule ID: ML-LOG-016] Event Struct Declared with Redundant store or key Ability

> **⚙️ Implementation: `REGEX`** — Pattern: `struct\s+\w*[Ee]vent\w*\s+has\s+[^{]*\b(?:store|key)\b`


- **Pattern**: Declaring an event struct with the `store` or `key` abilities when only `copy` and `drop` are needed for emission, unnecessarily widening the capability of the event data.
- **Real Case**: MoveBit "Sui Objects Security Best Practices": Event parameters require only `copy + drop` abilities. Adding `store` violates minimal-ability safety principles and can expose event data to unauthorized wrapping.
- **Detection Logic**: IF a struct used exclusively in `event::emit` declares the `store` or `key` ability THEN flag as **Low**.
- **False Positive**: Structs designed to serve both as events and as database-stored objects.
- **Severity**: Low
- **Fix**: Restrict event struct definitions to have only the `copy` and `drop` abilities.

---

### [Rule ID: ML-LOG-017] Re-invokable Atomic Initiator Overwriting Snapshot Invariant

> **⚙️ Implementation: `REGEX`** — Pattern: `fun\s+\w+[^{]*\{(?!.*assert!.*!.*in_progress).*(?:in_progress|operation_active)\s*=`


- **Pattern**: An atomic or hot-potato operation has a `start` function that snapshots state and a `finish` function that validates against that snapshot, but the `start` function can be called multiple times in the same PTB, resetting the snapshot and defeating the post-condition.
- **Real Case**: Monethic workshop Lab 7: A strategy harvest function set `operation_in_progress = true` and snapshotted reserves. However, calling `start_harvest` twice within the same transaction reset the snapshot to a depleted value, allowing a return validation check to pass incorrectly.
- **Detection Logic**: IF a function captures state into a snapshot and sets an active flag AND fails to assert that the flag is false at entry THEN flag as **High**.
- **False Positive**: Multi-step initiators that explicitly check and block repeated execution.
- **Severity**: High
- **Fix**: Assert that the operation is not already active: `assert!(!vault.operation_in_progress, EInProgress);` at the start of the initiator function.

---

### [Rule ID: ML-LOG-018] zkLogin Address Derived from Mutable Claim

> **⚙️ Implementation: `REGEX`** — Pattern: `(?:email|name|phone)\s*[,)][^;]*(?:address|salt|seed)`


- **Pattern**: Deriving a user's address seed or salt in a zkLogin integration from a mutable claim (such as `email` or `name`) instead of the provider-stable `sub` claim. If the provider reassigns the email or name, another account can inherit the user's address.
- **Real Case**: Sui zkLogin guidelines: "use claims that are fixed once and never changed... zkLogin currently supports `sub`." Deriving addresses from mutable claims leads to potential account takeover.
- **Detection Logic**: IF zkLogin salt or address derivation inputs a mutable OIDC claim (like `email`, `name`, `phone`) instead of `sub` THEN flag as **High**.
- **False Positive**: Providers that programmatically guarantee the immutability of specific email claims with verification.
- **Severity**: High
- **Fix**: Always use the provider-stable `sub` claim as the anchor for zkLogin address derivation.

---

### [Rule ID: ML-LOG-019] Missing JWT Binding or Validation in Relying Party

> **⏭️ Implementation: `SKIP_MVP`** — Requires JWT/OIDC claim validation flow analysis


- **Pattern**: A zkLogin relying party or proving service does not bind the OIDC nonce to the user's ephemeral public key and expiration epoch, or fails to validate OIDC fields (`aud`, `iss`), enabling JWT replay attacks.
- **Real Case**: Brave Research "zkLogin: when ZKP is not enough": Relying parties failing to check nonce commitments allows attackers to reuse OIDC proofs across different client applications.
- **Detection Logic**: IF zkLogin verification code does not check nonce commitments to ephemeral public keys AND lacks validation of `iss`/`aud` fields THEN flag as **High**.
- **False Positive**: Applications that delegate verification tasks to verified and audited SDK libraries.
- **Severity**: High
- **Fix**: Enforce that the nonce is a cryptographic hash of the ephemeral public key, max epoch, and user randomness, and validate issuer (`iss`) and audience (`aud`).

---

### [Rule ID: ML-LOG-020] Flash-Loan-Amplified Governance weight in Single PTB

> **⚙️ Implementation: `REGEX`** — Pattern: `(?:voting_power|vote_weight|governance_weight)\s*=\s*(?:balance|coin::value|token_balance)\s*\(`


- **Pattern**: Computing voting weight, minting quotas, or reward eligibility based on a user's current token balance within a single transaction. Attackers can take a flash loan to inflate their balance, perform the governance action, and repay the loan in the same PTB.
- **Real Case**: Trail of Bits: Flash loans enforce repayment at the transaction level, but do not prevent snapshot-less governance attacks. Attacking governance weight via flash loans is a classic vulnerability class that applies to Move protocols.
- **Detection Logic**: IF governance or voting weights are calculated from active token balances AND there is no time-lock or historical snapshot requirement THEN flag as **High**.
- **False Positive**: Governance systems using time-weighted average balances (TWAP) or historical epoch snapshots.
- **Severity**: High
- **Fix**: Measure voting power or privilege thresholds using historical snapshots (e.g., balance at epoch start) or locked stakes.

---

## CTF Quick Reference — Exploitable Patterns from Competitions

### MoveCTF 2024 (MoveBit / Sui Foundation — 527 teams)
- **DEX Challenge**: Token swap with 100-token vault and 10-token user allocation. Exploit: integer rounding in exchange rate allows extracting more than deposited. Detection: `ML-ARI-001`, `ML-ARI-003`.
- **Cryptography/ZK Challenge**: Incorrect proof format handling — Sui Groth16 verifier expected different byte encoding than ark_circom library output. Not directly a Move bug but a cross-layer integration failure. Detection: `ML-EXT-003`.
- **Matryoshka/Object Hiding**: Repository object with commits had a hidden wrapped object recoverable only by knowing the exact wrapping path. Detection: `ML-WRP-002`.

### MetaTrust Sui CTF 2023
- Core challenge was access control bypass via public function misconfiguration — identical pattern to `ML-ACC-001`.
- Object capability replay attack — identical to `ML-OBJ-004`.

### Numen Cyber CTF 2023 (Move Challenges)
- Flash loan receipt not validated against source — identical to `ML-HOT-002`.

---

## Summary Index

| Rule ID | Vulnerability | Severity |
|---|---|---|
| ML-ACC-001 | Public function missing capability | Critical |
| ML-ACC-002 | public(package) as access control | High |
| ML-ACC-003 | Hardcoded address authorization | Medium |
| ML-ACC-004 | Generic capability phantom substitution | Critical |
| ML-ACC-005 | Caller vs sender confusion | Critical |
| ML-ACC-006 | Missing access control on shared object | High |
| ML-ACC-007 | Capability with store/copy abilities | High |
| ML-ACC-008 | Non-exclusive framework capability used as authorization gate | Critical |
| ML-ACC-009 | Privilege-escalation via weakly-gated capability-minting | High |
| ML-ACC-010 | entry modifier defeats public(package)/private intent | High |
| ML-ACC-011 | Generic witness accepted in policy/rule without verification | High |
| ML-ACC-012 | signer or SignerCapability stored by or handed to untrusted module | Critical |
| ML-ACC-013 | Resource account or derived address pre-claim squatting | Medium |
| ML-OBJ-001 | Missing ownership verification | High |
| ML-OBJ-002 | Shared object misclassification | High |
| ML-OBJ-003 | Unauthorized mutation via shared ref | High |
| ML-OBJ-004 | Single-use capability reuse | Critical |
| ML-OBJ-005 | Capability or asset shared via public_share_object instead of transferred | Critical |
| ML-OBJ-006 | store ability added to object enabling public_transfer bypass | High |
| ML-OBJ-007 | UID resurrection via extracting and re-wrapping | High |
| ML-OBJ-008 | Function assumes single-owner provenance but accepts frozen/shared object | High |
| ML-OBJ-009 | Derived-object ID prediction or pre-claim squatting | Medium |
| ML-OBJ-010 | Unauthorized receive or public_receive from shared object | High |
| ML-OBJ-011 | Deleting object with non-drop dynamic fields locks values | High |
| ML-OBJ-012 | Kiosk or TransferPolicy royalty bypass via KioskOwnerCap transfer | Medium |
| ML-OBJ-013 | Exclusive listing or PurchaseCap loss locks kiosk item | Medium |
| ML-INT-001 | checked_shlw bitmask — Cetus class | Critical |
| ML-INT-002 | Missing overflow guard on bit shift | High |
| ML-INT-003 | Incorrect bit mask width | Critical |
| ML-INT-004 | Division by zero unguarded | Medium |
| ML-INT-005 | u64 truncation in mul_div | High |
| ML-INT-006 | Silent truncation via narrowing cast | High |
| ML-ARI-001 | Division before multiplication | High |
| ML-ARI-002 | Insufficient scale factor | Medium |
| ML-ARI-003 | Rounding direction inconsistency | Medium |
| ML-ARI-004 | Price calculation drift | Medium |
| ML-ARI-005 | Unchecked bitwise overflow | High |
| ML-ARI-006 | Protocol fee rounds to zero for small amounts | Medium |
| ML-ARI-007 | Cross-chain amount precision conversion error | High |
| ML-HOT-001 | Hot potato with unintended ability | Critical |
| ML-HOT-002 | Receipt not validated vs source object | Critical |
| ML-HOT-003 | Flash loan price oracle manipulation | High |
| ML-HOT-004 | Reentrance-equivalent via sequencing | High |
| ML-UPG-001 | UpgradeCap not validated to package | Critical |
| ML-UPG-002 | init not re-run / migration missing | High |
| ML-UPG-003 | Old version callable, invariant violated | High |
| ML-UPG-004 | No upgrade policy on UpgradeCap | Medium |
| ML-RAC-001 | Shared object front-running | Medium |
| ML-RAC-002 | TOCTOU on shared object | Medium |
| ML-RAC-003 | Shared object contention DoS | Low |
| ML-RET-001 | Coin return value dropped | Critical |
| ML-RET-002 | Error/bool return swallowed | High |
| ML-RET-003 | Transfer return not propagated | Medium |
| ML-RET-004 | Error or overflow flag discarded while using zeroed result | High |
| ML-TOK-001 | split amount not validated | High |
| ML-TOK-002 | TreasuryCap accessible / unlimited mint | Critical |
| ML-TOK-003 | Nested token balance leakage | High |
| ML-TOK-004 | Over/under-payment not validated | High |
| ML-TOK-005 | Unfrozen coin metadata | Medium |
| ML-TOK-006 | Vault first-depositor share inflation via direct donation | High |
| ML-TOK-007 | Unauthorized fee deposit to arbitrary partner account | Medium |
| ML-TOK-008 | Missing coin::is_account_registered check before deposit | Medium |
| ML-WRP-001 | freeze_object locks inner objects | High |
| ML-WRP-002 | No unwrap path — permanent lock | High |
| ML-WRP-003 | Wrap without store ability | Medium |
| ML-DOS-001 | Unbounded loop on user collection | High |
| ML-DOS-002 | Shared object starvation | Medium |
| ML-DOS-003 | Resource exhaustion via object creation | Low |
| ML-DOS-004 | DoS via table::add on recurrent user-controlled key | Medium |
| ML-EXT-001 | Unvalidated external library math | High |
| ML-EXT-002 | Dependency not updated after upgrade | Medium |
| ML-EXT-003 | Cross-module stale version invariant | Medium |
| ML-EXT-004 | Orphaned friend module | Medium |
| ML-LOG-001 | Invalid state machine transition | High |
| ML-LOG-002 | Missing global invariant post multi-step | Medium |
| ML-LOG-003 | Reentrancy-equivalent via generics | Medium |
| ML-LOG-004 | Time unit confusion ms/s/epoch | High |
| ML-LOG-005 | Cross-function PTB invariant violation | Medium |
| ML-LOG-006 | OTW / Publisher misuse | High |
| ML-LOG-007 | Pointer reassignment bug | Critical |
| ML-LOG-008 | Generic type parameter not validated against user-supplied index | Critical |
| ML-LOG-009 | Paired object not bound by stored ID | High |
| ML-LOG-010 | Wrong standard-library function causes runtime abort | Medium |
| ML-LOG-011 | Randomness-dependent branch with outcome-dependent gas | Critical |
| ML-LOG-012 | Randomness-consuming function declared public instead of entry | High |
| ML-LOG-013 | RandomGenerator passed as function argument | High |
| ML-LOG-014 | Missing pool-pause or suspended state check | Medium |
| ML-LOG-015 | Event emitted on attacker-controlled path or missing event | Medium |
| ML-LOG-016 | Event struct declared with redundant store or key ability | Low |
| ML-LOG-017 | Re-invokable atomic initiator overwriting snapshot invariant | High |
| ML-LOG-018 | zkLogin address derived from mutable claim | High |
| ML-LOG-019 | Missing JWT binding or validation in relying party | High |
| ML-LOG-020 | Flash-loan-amplified governance weight in single PTB | High |

**Total rules: 93 across 13 sectors.**

---

## Implementation Notes for Layer 1 (Deterministic Rules)

**High-confidence regex targets (implement first):**
1. `<<` on `u256`/`u128` with no preceding bounds check — `ML-INT-001`, `ML-INT-002`
2. `0xffffffffffffffff` literal in shift context — `ML-INT-001`
3. `transfer::share_object` on types with balance/key fields — `ML-OBJ-002`
4. `has drop` or `has copy` on structs named `*Receipt*`/`*Potato*`/`*Flash*` — `ML-HOT-001`
5. `public fun` with no capability param that writes to privileged struct — `ML-ACC-001`
6. `let _ =` discarding a return of type `Coin<*>`/`Balance<*>` — `ML-RET-001`
7. `UpgradeCap` param without `package::upgrade_package` call — `ML-UPG-001`
8. Division expression `/ ` followed by `*` without reorder — `ML-ARI-001`

**AST visitor targets (Layer 1 + Layer 2):**
- Struct ability set analysis for hot potatoes
- Function parameter type analysis for capability patterns
- Control flow analysis for state machine transitions
- Inter-procedural return value tracking

**Seed these rules into Layer 3 (MemWal) as the initial persistent findings corpus.**