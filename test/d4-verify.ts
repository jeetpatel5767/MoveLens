/**
 * test/d4-verify.ts — D4 Demo Fallback + SECURITY.md + PRIVACY.md verify
 *
 * Steps:
 *   1. AuditJob interface has degraded field (type check via import)
 *   2. Store migration: degraded column exists in DDL + upsert
 *   3. GET /api/audit response includes degraded field
 *   4. DEMO_MODE_BLOB_ID in .env.example
 *   5. route.ts has DEMO_MODE_BLOB_ID fallback logic
 *   6. audit/[id]/page.tsx has JobStatus.degraded and degraded banner
 *   7. SECURITY.md exists and references key mitigations
 *   8. PRIVACY.md exists and has opt-in on-chain section + data retention
 *
 * Run: npx tsx test/d4-verify.ts
 */

require("dotenv/config");

import { readFileSync, existsSync } from "fs";

let passed = 0;
let failed = 0;

function pass(msg: string) { console.log(`PASS ${msg}`); passed++; }
function fail(msg: string) { console.error(`FAIL ${msg}`); failed++; }

async function main() {
  // ── Step 1: AuditJob has degraded field ──────────────────────────────────────
  console.log("\n── Step 1: AuditJob interface has degraded field ───────────────────────────");
  {
    const { createJob, updateJob, getJob } = await import("../src/lib/store/audits");
    const job = createJob();
    updateJob(job, { degraded: true });
    const retrieved = getJob(job.id);
    if (retrieved?.degraded === true) {
      pass("step1: AuditJob.degraded persists through store round-trip ✓");
    } else {
      fail(`step1: expected degraded=true, got: ${retrieved?.degraded}`);
    }
    // Cleanup: update back to false
    updateJob(job, { degraded: false });
  }

  // ── Step 2: Store SQL includes degraded column ────────────────────────────────
  console.log("\n── Step 2: store DDL and upsert include degraded column ────────────────────");
  {
    const storeSource = readFileSync("src/lib/store/audits.ts", "utf8");
    if (storeSource.includes("degraded") && storeSource.includes("ALTER TABLE audit_jobs ADD COLUMN degraded")) {
      pass("step2: store has degraded in DDL + migration ALTER TABLE ✓");
    } else {
      fail("step2: missing degraded column in DDL or migration");
    }
    if (storeSource.includes("$degraded")) {
      pass("step2b: upsert statement includes $degraded parameter ✓");
    } else {
      fail("step2b: upsert missing $degraded parameter");
    }
  }

  // ── Step 3: GET /api/audit returns degraded field ─────────────────────────────
  console.log("\n── Step 3: GET /api/audit?id=... response includes degraded ───────────────");
  {
    const routeSource = readFileSync("src/app/api/audit/route.ts", "utf8");
    if (routeSource.includes("degraded:") && routeSource.includes("job.degraded")) {
      pass("step3: GET handler exposes degraded field ✓");
    } else {
      fail("step3: GET handler missing degraded in response");
    }
  }

  // ── Step 4: DEMO_MODE_BLOB_ID in .env.example ─────────────────────────────────
  console.log("\n── Step 4: DEMO_MODE_BLOB_ID in .env.example ───────────────────────────────");
  {
    const envExample = readFileSync(".env.example", "utf8");
    if (envExample.includes("DEMO_MODE_BLOB_ID")) {
      pass("step4: DEMO_MODE_BLOB_ID documented in .env.example ✓");
    } else {
      fail("step4: DEMO_MODE_BLOB_ID missing from .env.example");
    }
  }

  // ── Step 5: route.ts has DEMO_MODE_BLOB_ID fallback logic ────────────────────
  console.log("\n── Step 5: route.ts Walrus upload wrapped with DEMO_MODE_BLOB_ID fallback ─");
  {
    const routeSource = readFileSync("src/app/api/audit/route.ts", "utf8");
    if (routeSource.includes("DEMO_MODE_BLOB_ID") && routeSource.includes("degraded = true")) {
      pass("step5: DEMO_MODE_BLOB_ID fallback implemented in route.ts ✓");
    } else {
      fail("step5: route.ts missing DEMO_MODE_BLOB_ID fallback or degraded=true flag");
    }
    if (routeSource.includes("try {") && routeSource.includes("uploadAuditQuilt") && routeSource.includes("} catch (uploadErr)")) {
      pass("step5b: uploadAuditQuilt wrapped in try/catch ✓");
    } else {
      fail("step5b: uploadAuditQuilt not wrapped in try/catch");
    }
  }

  // ── Step 6: audit page has degraded field + banner ────────────────────────────
  console.log("\n── Step 6: audit/[id]/page.tsx has JobStatus.degraded + yellow banner ─────");
  {
    const pageSource = readFileSync("src/app/audit/[id]/page.tsx", "utf8");
    if (pageSource.includes("degraded?: boolean")) {
      pass("step6: JobStatus has degraded?: boolean ✓");
    } else {
      fail("step6: JobStatus missing degraded?: boolean");
    }
    if (pageSource.includes("job.degraded") && pageSource.includes("Cached reference audit")) {
      pass("step6b: degraded banner renders when job.degraded=true ✓");
    } else {
      fail("step6b: degraded banner missing or not conditional on job.degraded");
    }
  }

  // ── Step 7: SECURITY.md ───────────────────────────────────────────────────────
  console.log("\n── Step 7: SECURITY.md exists with required sections ───────────────────────");
  {
    if (!existsSync("SECURITY.md")) {
      fail("step7: SECURITY.md missing");
    } else {
      const sec = readFileSync("SECURITY.md", "utf8");
      const checks: [string, string][] = [
        ["Threat Model",            "step7: Threat Model section present ✓"],
        ["sanitizeForPatterns",     "step7: sanitizeForPatterns mitigation documented ✓"],
        ["severity floor",          "step7: severity floor mitigation documented ✓"],
        ["Groq rate limit",         "step7: Groq rate limiter documented ✓"],
        ["Known Limitations",       "step7: Known Limitations section present ✓"],
        ["Reporting a Vulnerability", "step7: Responsible disclosure section present ✓"],
      ];
      for (const [needle, label] of checks) {
        if (sec.includes(needle)) { pass(label); } else { fail(`${label} — '${needle}' not found`); }
      }
    }
  }

  // ── Step 8: PRIVACY.md ────────────────────────────────────────────────────────
  console.log("\n── Step 8: PRIVACY.md exists with required sections ────────────────────────");
  {
    if (!existsSync("PRIVACY.md")) {
      fail("step8: PRIVACY.md missing");
    } else {
      const priv = readFileSync("PRIVACY.md", "utf8");
      const checks: [string, string][] = [
        ["publishOnChain",       "step8: on-chain publishing opt-in documented ✓"],
        ["findings.enc",         "step8: findings.enc private section documented ✓"],
        ["Data Retention",       "step8: data retention section present ✓"],
        ["audits.db",            "step8: local SQLite storage mentioned ✓"],
        ["Where Processing Happens", "step8: processing location table present ✓"],
        ["DeepSeek",             "step8: Layer 4 model documented ✓"],
      ];
      for (const [needle, label] of checks) {
        if (priv.includes(needle)) { pass(label); } else { fail(`${label} — '${needle}' not found`); }
      }
    }
  }

  // ── Summary ──────────────────────────────────────────────────────────────────
  console.log(`\nD4: ${passed}/${passed + failed} steps passed ${passed >= 16 ? "✓" : "✗"}`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("[d4-verify] Unexpected error:", err);
  process.exit(1);
});
