/**
 * test/f34-verify.ts
 *
 * F34 verification: SQLite job store — jobs survive dev server restarts.
 *
 * Steps:
 *   1. Start dev server, run an audit, get the auditId
 *   2. Verify audits.db file exists in project root
 *   3. Direct DB query shows job persisted (proves restart would work)
 *   4. Pruning: old jobs (>24h) are removed by pruneOldJobs()
 *   5. Recent jobs survive pruning
 *
 * Run: npx tsx test/f34-verify.ts
 * Requires: dev server on :3000
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
require("dotenv/config");

import Database from "better-sqlite3";
import { existsSync } from "fs";
import { DB_PATH, pruneOldJobs } from "../src/lib/store/audits";

let passed = 0;
let failed = 0;

function pass(msg: string) { console.log(`PASS ${msg}`); passed++; }
function fail(msg: string) { console.error(`FAIL ${msg}`); failed++; }

async function main() {
  // ── Step 1: Run an audit via the dev server ─────────────────────────────────
  console.log("\n── Step 1: Submit audit, get auditId ───────────────────────────────");

  let auditId: string | null = null;
  try {
    const res = await fetch("http://localhost:3000/api/audit", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({
        source: { files: [{ name: "test.move", content: "module test::t { public fun f() {} }" }] },
        network: "testnet",
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const data = await res.json() as { auditId?: string; error?: string };
    if (!res.ok || !data.auditId) {
      fail(`step1: POST /api/audit failed: ${data.error ?? res.status}`);
    } else {
      auditId = data.auditId;
      console.log(`  auditId: ${auditId}`);
      pass("step1: audit job created");
    }
  } catch (err) {
    fail(`step1: dev server unreachable — ${err}`);
  }

  if (!auditId) {
    console.log("\nCannot proceed without auditId — aborting remaining steps");
    process.exit(1);
  }

  // ── Wait for the job to progress (at least past "queued") ───────────────────
  console.log("\n  Waiting for job to progress...");
  let finalStatus = "queued";
  for (let attempt = 0; attempt < 20; attempt++) {
    await new Promise((r) => setTimeout(r, 2_000));
    try {
      const r = await fetch(`http://localhost:3000/api/audit?id=${auditId}`, {
        signal: AbortSignal.timeout(5_000),
      });
      const d = await r.json() as { status: string };
      finalStatus = d.status;
      process.stdout.write(`  status=${finalStatus}\r`);
      if (finalStatus === "done" || finalStatus === "failed") break;
    } catch { /* ignore poll errors */ }
  }
  console.log(`\n  Final status: ${finalStatus}`);

  // ── Step 2: audits.db file exists ────────────────────────────────────────────
  console.log("\n── Step 2: audits.db exists in project root ────────────────────────");
  console.log(`  DB_PATH: ${DB_PATH}`);

  if (!existsSync(DB_PATH)) {
    fail(`step2: audits.db not found at ${DB_PATH}`);
  } else {
    pass(`step2: audits.db exists`);
  }

  // ── Step 3: Direct DB query — job is in DB ───────────────────────────────────
  console.log("\n── Step 3: Job persisted in DB (proves restart durability) ─────────");

  let testDb: Database.Database | null = null;
  try {
    testDb = new Database(DB_PATH, { readonly: true });
    const row = testDb.prepare("SELECT id, status, stages_visited FROM audit_jobs WHERE id = ?").get(auditId) as
      { id: string; status: string; stages_visited: string } | undefined;

    if (!row) {
      fail(`step3: auditId ${auditId} not found in audits.db`);
    } else {
      const stages = JSON.parse(row.stages_visited) as string[];
      console.log(`  DB row: id=${row.id}, status=${row.status}, stages=${stages.join(",")}`);
      pass(`step3: job ${auditId} persisted in audits.db (status=${row.status}) — restart-safe ✓`);
    }
  } catch (err) {
    fail(`step3: DB query error — ${err}`);
  } finally {
    testDb?.close();
  }

  // ── Step 4: Pruning removes jobs older than 24h ──────────────────────────────
  console.log("\n── Step 4: Jobs older than 24h are pruned ──────────────────────────");

  {
    // Use a separate writable connection for pruning tests
    const pdb = new Database(DB_PATH);
    pdb.pragma("journal_mode = WAL");

    // Insert a clearly old job (48h ago)
    const oldId = "prune-test-" + Date.now();
    const oldAt = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    pdb.prepare(`
      INSERT OR REPLACE INTO audit_jobs
        (id, status, stages_visited, report, blob_id, tx_digest, error, created_at, updated_at)
      VALUES (?, 'done', '["queued","done"]', null, null, null, null, ?, ?)
    `).run(oldId, oldAt, oldAt);

    const before = pdb.prepare("SELECT id FROM audit_jobs WHERE id = ?").get(oldId);
    if (!before) {
      fail("step4: could not insert test row — DB may be locked");
      pdb.close();
    } else {
      console.log(`  Inserted old job: id=${oldId}, created_at=${oldAt}`);
      const pruned = pruneOldJobs(pdb);
      console.log(`  Pruned ${pruned} row(s)`);

      const after = pdb.prepare("SELECT id FROM audit_jobs WHERE id = ?").get(oldId);
      if (after) {
        fail(`step4: old job ${oldId} still present after pruning`);
      } else {
        pass("step4: job older than 24h removed by pruneOldJobs() ✓");
      }
      pdb.close();
    }
  }

  // ── Step 5: Recent jobs survive pruning ──────────────────────────────────────
  console.log("\n── Step 5: Recent jobs survive pruning ─────────────────────────────");

  {
    const pdb = new Database(DB_PATH, { readonly: true });
    const row = pdb.prepare("SELECT id FROM audit_jobs WHERE id = ?").get(auditId) as
      { id: string } | undefined;
    pdb.close();

    if (!row) {
      fail(`step5: recent job ${auditId} was pruned — should survive`);
    } else {
      pass(`step5: recent job ${auditId} survived pruning ✓`);
    }
  }

  // ── Summary ──────────────────────────────────────────────────────────────────
  console.log(`\nF34: ${passed}/${passed + failed} steps passed ${passed === 5 ? "✓" : "✗"}`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("[f34-verify] Unexpected error:", err);
  process.exit(1);
});
