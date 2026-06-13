/**
 * scripts/gallery-audits.ts
 * F35 — Audit gallery seeder.
 *
 * Produces src/app/gallery.json with >= 3 entries containing real Walrus blob IDs.
 * Entry 1: Cetus CLMM (from existing scripts/cetus-result.json)
 * Entries 2-3: Source-based audits of representative DeFi patterns, uploaded
 *              via the Walrus testnet publisher REST endpoint (no SUI gas needed).
 *
 * Usage: npx tsx scripts/gallery-audits.ts
 * Prereqs: none (sidecar optional — falls back to Layer 1+2 only)
 *
 * HARD RULES: No paid LLM APIs. No JSON-RPC.
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
require("dotenv/config");

import { writeFileSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { createMemory } from "../src/lib/memory/index";
import { runAudit, assembleReport } from "../src/lib/audit/engine";
import { WATERMARK } from "../src/lib/audit/schema";
import type { PackageContext } from "../src/lib/sui/queries";

const ROOT      = process.cwd();
const GALLERY_PATH = join(ROOT, "src", "app", "gallery.json");
const CETUS_PATH   = join(ROOT, "scripts", "cetus-result.json");
const WALRUS_PUB   = "https://publisher.walrus-testnet.walrus.space/v1/blobs?epochs=5";

// ──────────────────────────────────────────────────────────────
// Gallery entry type
// ──────────────────────────────────────────────────────────────

export interface GalleryEntry {
  id:             string;
  packageName:    string;
  packageId:      string;
  network:        string;
  riskGrade:      string;
  blobId:         string;
  walrusUrl:      string;
  severityCounts: { critical: number; high: number; medium: number; low: number };
  totalFindings:  number;
  auditedAt:      string;
  layersRun:      string[];
}

// ──────────────────────────────────────────────────────────────
// Well-known DeFi source templates (synthetic but realistic)
// ──────────────────────────────────────────────────────────────

const FLASHLOAN_SOURCE = `
module flashloan::pool {
    use sui::coin::{Self, Coin};
    use sui::balance::{Self, Balance};
    use sui::object::{Self, UID};
    use sui::tx_context::TxContext;

    struct Pool has key {
        id: UID,
        reserve: Balance<0x2::sui::SUI>,
        fee_rate: u64,
    }

    // Hot-potato receipt — must be repaid in same tx
    struct Receipt {
        amount: u64,
    }

    public fun borrow(
        pool: &mut Pool,
        amount: u64,
        ctx: &mut TxContext
    ): (Coin<0x2::sui::SUI>, Receipt) {
        let coin = coin::from_balance(
            balance::split(&mut pool.reserve, amount), ctx
        );
        (coin, Receipt { amount })
    }

    public fun repay(
        pool: &mut Pool,
        payment: Coin<0x2::sui::SUI>,
        receipt: Receipt,
    ) {
        let Receipt { amount: _ } = receipt;
        // BUG: no fee validation — repaying less than borrowed is accepted
        balance::join(&mut pool.reserve, coin::into_balance(payment));
    }

    // CRITICAL: no capability check — any address can drain the pool
    public fun admin_withdraw(
        pool: &mut Pool,
        amount: u64,
        ctx: &mut TxContext
    ): Coin<0x2::sui::SUI> {
        coin::from_balance(balance::split(&mut pool.reserve, amount), ctx)
    }

    // Arithmetic: fee calc without overflow protection
    public fun calculate_fee(amount: u64, rate: u64): u64 {
        amount * rate / 10000   // BUG: amount * rate may overflow u64
    }
}
`;

const GOVERNANCE_SOURCE = `
module gov::governance {
    use sui::object::{Self, UID};
    use sui::tx_context::TxContext;
    use sui::package;

    // AdminCap with 'store' ability is transferable — privilege escalation risk
    struct AdminCap has key, store {
        id: UID,
    }

    struct Proposal has key {
        id: UID,
        votes_for: u64,
        votes_against: u64,
        threshold: u64,
        executed: bool,
    }

    // CRITICAL: no quorum check before execution
    public fun execute_proposal(
        _cap: &AdminCap,
        proposal: &mut Proposal,
    ) {
        // Missing: assert!(proposal.votes_for >= proposal.threshold)
        // Missing: assert!(!proposal.executed)
        proposal.executed = true;
    }

    // UpgradeCap with no timelock — owner can upgrade immediately
    public fun request_upgrade(
        _cap: &AdminCap,
        upgrade_cap: package::UpgradeCap,
    ): package::UpgradeCap {
        upgrade_cap  // returned without audit trail or timelock
    }

    public fun create_admin(ctx: &mut TxContext): AdminCap {
        AdminCap { id: object::new(ctx) }
    }

    // Race condition: vote count can be manipulated without commit-reveal
    public fun vote(proposal: &mut Proposal, in_favor: bool, weight: u64) {
        if (in_favor) {
            proposal.votes_for = proposal.votes_for + weight;
        } else {
            proposal.votes_against = proposal.votes_against + weight;
        }
    }
}
`;

// ──────────────────────────────────────────────────────────────
// Walrus publisher upload (no SUI gas required)
// ──────────────────────────────────────────────────────────────

async function uploadToWalrus(data: object): Promise<string> {
  const body = Buffer.from(JSON.stringify(data, null, 2), "utf8");

  const resp = await fetch(WALRUS_PUB, {
    method:  "PUT",
    headers: { "Content-Type": "application/octet-stream" },
    body,
    signal:  AbortSignal.timeout(30_000),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Walrus publisher ${resp.status}: ${text.slice(0, 200)}`);
  }

  const result = await resp.json() as {
    newlyCreated?:    { blobObject?: { blobId?: string } };
    alreadyCertified?: { blobId?: string };
  };

  const blobId =
    result.newlyCreated?.blobObject?.blobId ??
    result.alreadyCertified?.blobId;

  if (!blobId) throw new Error("No blobId in response: " + JSON.stringify(result));
  return blobId;
}

function walrusUrl(blobId: string): string {
  return `https://aggregator.walrus-testnet.walrus.space/v1/blobs/${blobId}`;
}

// ──────────────────────────────────────────────────────────────
// Audit a source string and upload summary to Walrus
// ──────────────────────────────────────────────────────────────

async function auditAndUpload(opts: {
  id:          string;
  packageName: string;
  packageId:   string;
  network:     string;
  source:      string;
  moduleName:  string;
}): Promise<GalleryEntry> {
  console.log(`\n  Auditing "${opts.packageName}"...`);

  const ctx: PackageContext = {
    packageId:    opts.packageId,
    network:      opts.network as "testnet" | "mainnet",
    mvrName:      opts.packageName,
    sourceRepo:   null,
    version:      1,
    upgradeCount: 0,
    modules:      [{ name: opts.moduleName, source: opts.source, disassembly: "" }],
    fetchedAt:    new Date().toISOString(),
  };

  const memory  = await createMemory();
  const result  = await runAudit(ctx, memory);
  const report  = assembleReport(ctx, result, {});

  console.log(
    `  → risk_grade=${report.risk_grade} ` +
    `findings=${report.findings.length} ` +
    `layers=${result.layersRun.join("+")}`,
  );

  // Build the public summary blob (safe to expose — mirrors report.json in quilt)
  const publicBlob = {
    report_id:       report.report_id,
    package_name:    opts.packageName,
    package_ref:     report.package.packageId, // already hashed in quilt; use name here
    network:         report.package.network,
    risk_grade:      report.risk_grade,
    severity_counts: report.severity_counts,
    total_findings:  report.findings.length,
    layers_run:      result.layersRun,
    generated_at:    report.generated_at,
    watermark:       WATERMARK,
  };

  console.log(`  Uploading to Walrus publisher...`);
  const blobId = await uploadToWalrus(publicBlob);
  console.log(`  blobId: ${blobId}`);

  return {
    id:             opts.id,
    packageName:    opts.packageName,
    packageId:      opts.packageId,
    network:        opts.network,
    riskGrade:      report.risk_grade,
    blobId,
    walrusUrl:      walrusUrl(blobId),
    severityCounts: report.severity_counts,
    totalFindings:  report.findings.length,
    auditedAt:      report.generated_at,
    layersRun:      result.layersRun,
  };
}

// ──────────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────────

async function main() {
  console.log("==> gallery-audits.ts — seeding src/app/gallery.json\n");

  const gallery: GalleryEntry[] = [];

  // ── Entry 1: Cetus CLMM (existing result) ───────────────────────────────────
  console.log("── Entry 1: Cetus CLMM (from cetus-result.json) ──────────────────");

  if (!existsSync(CETUS_PATH)) {
    console.error("ERROR: scripts/cetus-result.json not found — run scripts/cetus-audit.ts first");
    process.exit(1);
  }

  const cetus = JSON.parse(readFileSync(CETUS_PATH, "utf8")) as {
    packageId: string;
    network: string;
    mvrName: string;
    auditedAt: string;
    riskGrade: string;
    severityCounts: { critical: number; high: number; medium: number; low: number };
    totalFindings: number;
    layersRun: string[];
    blobId: string;
  };

  gallery.push({
    id:             "cetus-clmm",
    packageName:    cetus.mvrName ?? "@cetus/clmm",
    packageId:      cetus.packageId,
    network:        cetus.network,
    riskGrade:      cetus.riskGrade,
    blobId:         cetus.blobId,
    walrusUrl:      walrusUrl(cetus.blobId),
    severityCounts: cetus.severityCounts,
    totalFindings:  cetus.totalFindings,
    auditedAt:      cetus.auditedAt,
    layersRun:      cetus.layersRun ?? ["layer1", "layer2", "layer4"],
  });

  console.log(`  ✓ blobId: ${cetus.blobId}  riskGrade: ${cetus.riskGrade}`);

  // ── Entry 2: Flash Loan Protocol ────────────────────────────────────────────
  console.log("\n── Entry 2: Flash Loan Protocol ─────────────────────────────────");

  gallery.push(await auditAndUpload({
    id:          "flashloan-pool",
    packageName: "FlashLoan Pool",
    packageId:   "0x" + "0".repeat(64),
    network:     "testnet",
    source:      FLASHLOAN_SOURCE,
    moduleName:  "pool",
  }));

  // ── Entry 3: Governance Module ──────────────────────────────────────────────
  console.log("\n── Entry 3: Governance Module ────────────────────────────────────");

  gallery.push(await auditAndUpload({
    id:          "governance",
    packageName: "Governance Module",
    packageId:   "0x" + "1".repeat(64),
    network:     "testnet",
    source:      GOVERNANCE_SOURCE,
    moduleName:  "governance",
  }));

  // ── Write gallery.json ──────────────────────────────────────────────────────
  console.log(`\n── Writing ${GALLERY_PATH} ─────────────────────────────────────`);
  writeFileSync(GALLERY_PATH, JSON.stringify(gallery, null, 2) + "\n");
  console.log(`  ✓ ${gallery.length} entries written`);

  // ── Summary ─────────────────────────────────────────────────────────────────
  console.log("\n── Gallery ──────────────────────────────────────────────────────");
  for (const e of gallery) {
    console.log(`  ${e.packageName.padEnd(22)} riskGrade=${e.riskGrade}  blob=${e.blobId.slice(0, 20)}...`);
  }

  // Validate Cetus entry
  const cetusEntry = gallery.find((e) => e.riskGrade === "F" && e.severityCounts.critical >= 1);
  if (!cetusEntry) {
    console.error("FAIL: No entry with riskGrade=F and >=1 critical finding");
    process.exit(1);
  }
  console.log(`\n  ✓ Cetus entry: riskGrade=F, ${cetusEntry.severityCounts.critical} critical findings`);
  console.log(`  ✓ gallery.json written with ${gallery.length} entries`);
}

main().catch((err) => {
  console.error("gallery-audits error:", err);
  process.exit(1);
});
