/**
 * test/d1-verify.ts — D1 Core Engine Hardening verification
 *
 * Steps:
 *   1. sanitizeForPatterns strips comments — real code body still detectable by Layer 1
 *   2. "AdminCap" only in a comment does NOT cause ML-ACC false positive
 *   3. /classify returns a valid confidence (sidecar Python fix applied)
 *   4. mergeAndDedupe applies severity floor — ML-INT "low" is raised to "high"
 *   5. Full audit of flashloan snippet runs in < 90s (parallelism check)
 *
 * Run: npx tsx test/d1-verify.ts
 * Requires: dev server on :3000, Layer 4 sidecar on :8765
 */

require("dotenv/config");

import { sanitizeForPatterns } from "../src/lib/audit/sanitize";
import { runLayer1 } from "../src/lib/audit/layer1";
import { mergeAndDedupe } from "../src/lib/audit/engine";
import type { PackageContext } from "../src/lib/sui/queries";
import type { Finding } from "../src/lib/audit/schema";

let passed = 0;
let failed = 0;

function pass(msg: string) { console.log(`PASS ${msg}`); passed++; }
function fail(msg: string) { console.error(`FAIL ${msg}`); failed++; }

function makeCtx(source: string, modName = "test"): PackageContext {
  return {
    packageId:    "0x" + "0".repeat(64),
    network:      "testnet",
    mvrName:      null,
    sourceRepo:   null,
    version:      1,
    upgradeCount: 0,
    modules:      [{ name: modName, source, disassembly: "" }],
    fetchedAt:    new Date().toISOString(),
  };
}

async function main() {
  // ── Step 1: real admin_withdraw still flagged after sanitize ─────────────────
  console.log("\n── Step 1: real admin_withdraw still flagged after sanitize ────────────");
  {
    const REAL_ADMIN_WITHDRAW = `
module flashloan::pool {
    // AdminCap check here — comment mentions AdminCap but function has no cap param
    public fun admin_withdraw(
        pool: &mut Pool,
        amount: u64,
        ctx: &mut TxContext
    ): Coin<0x2::sui::SUI> {
        coin::from_balance(balance::split(&mut pool.reserve, amount), ctx)
    }
}`;
    const sanitized = sanitizeForPatterns(REAL_ADMIN_WITHDRAW, true);
    if (!sanitized.includes("admin_withdraw")) {
      fail("step1: function body removed by sanitize — should only strip comments");
    } else {
      const ctx = makeCtx(sanitized);
      const findings = runLayer1(ctx);
      const accFindings = findings.filter((f) => f.rule_id.startsWith("ML-ACC"));
      if (accFindings.length === 0) {
        fail("step1: ML-ACC finding should fire on real admin_withdraw (no cap param)");
      } else {
        pass(`step1: ML-ACC fires on real code — ${accFindings.length} finding(s) ✓`);
      }
    }
  }

  // ── Step 2: false positives from comments are gone ───────────────────────────
  // ML-UPG-004 fires on any source containing "UpgradeCap".
  // If UpgradeCap appears ONLY in a comment, it should NOT fire after sanitize.
  console.log("\n── Step 2: 'UpgradeCap' only in comment → no ML-UPG false positive ───");
  {
    const COMMENT_UPGRADECAP = `
module foo::safe {
    // Future: integrate UpgradeCap-based upgrade policy here
    // For now: module is immutable
    public fun get_version(): u64 { 1 }
}`;
    // Before sanitize: UpgradeCap in comment → ML-UPG-004 fires (false positive)
    const ctxRaw = makeCtx(COMMENT_UPGRADECAP);
    const rawFindings = runLayer1(ctxRaw);
    const rawUpg = rawFindings.filter((f) => f.rule_id === "ML-UPG-004");
    console.log(`  Before sanitize: ${rawUpg.length} ML-UPG-004 finding(s) (expected ≥ 1 — this is the old false positive)`);

    // After sanitize (which Layer 1 now does internally): the false positive is gone
    // We test by running Layer 1 on the sanitized source directly
    const sanitized = sanitizeForPatterns(COMMENT_UPGRADECAP, true);
    const commentStripped = !sanitized.includes("UpgradeCap");
    if (!commentStripped) {
      fail("step2: sanitize did not strip line comment — UpgradeCap still visible in sanitized source");
    } else {
      // Layer 1 internally re-sanitizes with preserveLines=true, same result
      // Directly test: run the regex rule on sanitized source
      const ctxSanitized = makeCtx(sanitized);
      const sanitizedFindings = runLayer1(ctxSanitized);
      const upgFindings = sanitizedFindings.filter((f) => f.rule_id === "ML-UPG-004");
      if (upgFindings.length > 0) {
        fail(`step2: ML-UPG-004 false positive still fires on sanitized source — ${upgFindings.length} finding(s)`);
      } else {
        pass("step2: ML-UPG-004 false positive eliminated — 'UpgradeCap' in comment no longer fires ✓");
      }
    }
  }

  // ── Step 3: /classify returns valid confidence from updated sidecar ──────────
  console.log("\n── Step 3: sidecar /classify returns valid confidence ──────────────────");
  {
    const snippet = `public fun drain(pool: &mut Pool, amount: u64, ctx: &mut TxContext) {
    coin::from_balance(balance::split(&mut pool.reserve, amount), ctx)
}`;
    try {
      const resp = await fetch("http://localhost:8765/classify", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ code: snippet }),
        signal:  AbortSignal.timeout(30_000),
      });
      const data = await resp.json() as { vulnerable: boolean; category: string; confidence: number };
      console.log(`  classify: vulnerable=${data.vulnerable} category=${data.category} confidence=${data.confidence}`);
      if (typeof data.confidence === "number" && data.confidence >= 0 && data.confidence <= 1) {
        pass(`step3: /classify returned valid confidence=${data.confidence} ✓`);
      } else {
        fail(`step3: unexpected confidence value: ${data.confidence}`);
      }
    } catch (err) {
      fail(`step3: /classify request failed — ${err}`);
    }
  }

  // ── Step 4: Severity floor — ML-INT/ML-ACC floors applied in mergeAndDedupe ──
  console.log("\n── Step 4: severity floor applied in mergeAndDedupe ────────────────────");
  {
    // ML-INT-L4-001 at "low" — should be floored to "high"
    const lowInt: Finding = {
      rule_id: "ML-INT-L4-001", severity: "low", confidence: 0.3,
      source: "layer4", module: "pool", line_start: 5, line_end: 10,
      description: "[Layer 4] Test", recommendation: "Fix", category: "int",
    };
    const floored = mergeAndDedupe([lowInt]);
    if (floored[0]?.severity !== "high") {
      fail(`step4a: ML-INT severity floor not applied — got ${floored[0]?.severity}, expected "high"`);
    } else {
      pass("step4a: ML-INT severity floored from low → high ✓");
    }

    // ML-ACC-L4-001 at "low" — should be floored to "medium"
    const lowAcc: Finding = {
      rule_id: "ML-ACC-L4-001", severity: "low", confidence: 0.3,
      source: "layer4", module: "pool", line_start: 15, line_end: 20,
      description: "[Layer 4] Test", recommendation: "Fix", category: "acc",
    };
    const floored2 = mergeAndDedupe([lowAcc]);
    if (floored2[0]?.severity !== "medium") {
      fail(`step4b: ML-ACC severity floor not applied — got ${floored2[0]?.severity}, expected "medium"`);
    } else {
      pass("step4b: ML-ACC severity floored from low → medium ✓");
    }

    // Layer 1 critical ML-INT preserved — the floor only raises, never lowers
    const l1Critical: Finding = {
      rule_id: "ML-INT-001", severity: "critical", confidence: 1.0,
      source: "layer1", module: "pool", line_start: 30, line_end: 35,
      description: "Bit-shift overflow", recommendation: "Fix", category: "int",
    };
    const preserved = mergeAndDedupe([l1Critical]);
    if (preserved[0]?.severity !== "critical") {
      fail(`step4c: Layer 1 critical was changed to ${preserved[0]?.severity} — floor should not lower`);
    } else {
      pass("step4c: Layer 1 ML-INT critical preserved (floor only raises, never lowers) ✓");
    }
  }

  // ── Step 5: Full audit runtime < 90s ─────────────────────────────────────────
  console.log("\n── Step 5: full audit time < 90s (parallelism) ─────────────────────────");
  {
    const source = `module flashloan::pool {
    use sui::coin::{Self, Coin};
    use sui::balance::{Self, Balance};
    use sui::object::{Self, UID};
    use sui::tx_context::TxContext;
    struct Pool has key { id: UID, reserve: Balance<0x2::sui::SUI>, fee_rate: u64 }
    struct Receipt { amount: u64 }
    public fun borrow(pool: &mut Pool, amount: u64, ctx: &mut TxContext): (Coin<0x2::sui::SUI>, Receipt) {
        let coin = coin::from_balance(balance::split(&mut pool.reserve, amount), ctx);
        (coin, Receipt { amount })
    }
    public fun repay(pool: &mut Pool, payment: Coin<0x2::sui::SUI>, receipt: Receipt) {
        let Receipt { amount: _ } = receipt;
        balance::join(&mut pool.reserve, coin::into_balance(payment));
    }
    public fun admin_withdraw(pool: &mut Pool, amount: u64, ctx: &mut TxContext): Coin<0x2::sui::SUI> {
        coin::from_balance(balance::split(&mut pool.reserve, amount), ctx)
    }
    public fun calculate_fee(amount: u64, rate: u64): u64 { amount * rate / 10000 }
}`;
    const start = Date.now();
    try {
      const postResp = await fetch("http://localhost:3000/api/audit", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          source: { files: [{ name: "flashloan.move", content: source }] },
          network: "testnet",
        }),
        signal: AbortSignal.timeout(10_000),
      });
      const { auditId } = await postResp.json() as { auditId: string };
      console.log(`  auditId: ${auditId}`);

      let finalStatus = "queued";
      for (let i = 0; i < 60; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const r = await fetch(`http://localhost:3000/api/audit?id=${auditId}`, { signal: AbortSignal.timeout(5_000) });
        const d = await r.json() as { status: string };
        finalStatus = d.status;
        process.stdout.write(`  status=${finalStatus}\r`);
        if (finalStatus === "done" || finalStatus === "failed") break;
      }

      const elapsed = Date.now() - start;
      console.log(`\n  Audit completed in ${(elapsed / 1000).toFixed(1)}s (status=${finalStatus})`);

      if (elapsed < 90_000) {
        pass(`step5: total audit time ${(elapsed / 1000).toFixed(1)}s < 90s ✓`);
      } else {
        fail(`step5: audit took ${(elapsed / 1000).toFixed(1)}s ≥ 90s`);
      }
    } catch (err) {
      fail(`step5: dev server unreachable — ${err}`);
    }
  }

  // ── Summary ──────────────────────────────────────────────────────────────────
  console.log(`\nD1: ${passed}/${passed + failed} steps passed ${passed >= 5 ? "✓" : "✗"}`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("[d1-verify] Unexpected error:", err);
  process.exit(1);
});
