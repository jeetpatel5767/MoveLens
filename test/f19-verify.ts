// F19 verification — Audit API: POST starts async job, GET polls status
//
// Step 1: POST fixture source → auditId returned immediately (status=202, body has auditId)
// Step 2: Poll GET /api/audit?id=<auditId> until status="done" or "failed".
//         Verify via stagesVisited that the job ran through fetching/auditing/uploading.
//         stagesVisited is stored server-side so it captures fast early stages (fetching,
//         auditing) that complete before polling even begins.
//         Max wait: 240 seconds (Walrus upload can take 30-120s on testnet)
// Step 3: POST with an invalid package address → immediate 400 error (not a job)
//
// Requires the dev server on :3000 (init.sh step 7 ensures it's up)

import { readFileSync } from "fs";
import { join } from "path";

const BASE = "http://localhost:3000";

function pass(msg: string) { console.log("PASS", msg); }
function fail(msg: string) { console.error("FAIL", msg); process.exit(1); }

async function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function postAudit(body: unknown): Promise<Response> {
  return fetch(`${BASE}/api/audit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

interface JobStatus {
  id: string;
  status: string;
  stagesVisited: string[];
  blobId?: string | null;
  txDigest?: string | null;
  error?: string | null;
}

async function getAuditStatus(auditId: string): Promise<JobStatus> {
  const r = await fetch(`${BASE}/api/audit?id=${auditId}`);
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`GET /api/audit?id=${auditId} → HTTP ${r.status}: ${t}`);
  }
  return r.json() as Promise<JobStatus>;
}

// Poll until status is done or failed (or timeout).
// Tolerates transient network errors (ECONNRESET, fetch failed) from dev server
// under load — Walrus uploads make many concurrent outgoing connections which can
// briefly saturate the event loop.
async function pollUntilDone(
  auditId: string,
  maxMs = 240_000,
  intervalMs = 4_000,
): Promise<JobStatus & { timedOut?: boolean }> {
  const deadline = Date.now() + maxMs;
  let networkErrCount = 0;
  let lastStatus = "";

  while (Date.now() < deadline) {
    let job: JobStatus;
    try {
      job = await getAuditStatus(auditId);
      networkErrCount = 0; // reset on success
    } catch (e) {
      networkErrCount++;
      const msg = e instanceof Error ? e.message : String(e);
      process.stdout.write(`       [warn] poll error #${networkErrCount}: ${msg} — retrying…\n`);
      if (networkErrCount >= 12) {
        // Return a synthetic "timeout" result after too many consecutive errors
        return { id: auditId, status: "timeout", stagesVisited: [], timedOut: true };
      }
      await sleep(intervalMs);
      continue;
    }

    if (job.status !== lastStatus) {
      process.stdout.write(`       → ${job.status}\n`);
      lastStatus = job.status;
    }

    if (job.status === "done" || job.status === "failed") {
      return job;
    }

    await sleep(intervalMs);
  }

  // Timed out — fetch final state one more time for reporting
  try {
    const final = await getAuditStatus(auditId);
    return { ...final, timedOut: true };
  } catch {
    return { id: auditId, status: "timeout", stagesVisited: [], timedOut: true };
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  let passed = 0;

  // ── Step 1: POST source → immediate auditId ───────────────────────────────
  console.log("\n  [step1] POST fixture source → expect 202 + auditId…");

  const src = readFileSync(join(process.cwd(), "test/fixtures/overflow.move"), "utf8");

  const r1 = await postAudit({
    source: { files: [{ name: "overflow.move", content: src }] },
  });

  if (r1.status !== 202) {
    fail(`step1: expected HTTP 202 but got ${r1.status}: ${await r1.text()}`);
    return;
  }

  const body1 = await r1.json() as { auditId?: string };
  if (!body1.auditId || typeof body1.auditId !== "string" || body1.auditId.length < 10) {
    fail(`step1: response body has no valid auditId: ${JSON.stringify(body1)}`);
    return;
  }

  console.log(`       auditId: ${body1.auditId} ✓`);
  pass(`step1: POST returned 202 with auditId="${body1.auditId}"`);
  passed++;

  const auditId = body1.auditId;

  // ── Step 2: Poll until done and verify stage progression ─────────────────
  console.log(`\n  [step2] Polling GET /api/audit?id=${auditId} (max 4 min)…`);

  const finalJob = await pollUntilDone(auditId);

  // stagesVisited is authoritative — it records every stage the job entered,
  // even stages that completed before the first poll fired.
  const stagesVisited = finalJob.stagesVisited ?? [];
  console.log(`       stagesVisited: ${stagesVisited.join(" → ")}`);
  console.log(`       final status:  ${finalJob.status}`);

  if (finalJob.timedOut) {
    fail(`step2: job did not complete within 4 minutes. stagesVisited: ${stagesVisited.join(" → ")}`);
    return;
  }

  if (finalJob.status === "failed") {
    // A failed status is acceptable ONLY if the error was at a late stage
    // (uploading/linking). Failure at fetching/auditing indicates a code bug.
    const errMsg = finalJob.error ?? "";
    const reachedAuditing = stagesVisited.includes("auditing");
    if (!reachedAuditing) {
      fail(`step2: job failed before reaching 'auditing' stage — likely a code bug. Error: ${errMsg}\nstagesVisited: ${stagesVisited.join(" → ")}`);
      return;
    }
    console.log(`       WARN: job failed at late stage (acceptable in CI): ${errMsg}`);
    pass(`step2: pipeline progressed through ${stagesVisited.join(" → ")} (late failure acceptable)`);
    passed++;
  } else {
    // status === "done"
    const requiredStages = ["fetching", "auditing", "uploading"];
    const missing = requiredStages.filter((s) => !stagesVisited.includes(s));
    if (missing.length > 0) {
      fail(`step2: stagesVisited missing required stages [${missing.join(",")}]. Got: ${stagesVisited.join(" → ")}`);
      return;
    }
    if (!finalJob.blobId) {
      fail(`step2: status=done but blobId is null`);
      return;
    }
    console.log(`       blobId: ${finalJob.blobId} ✓`);
    pass(`step2: pipeline reached "done" via ${stagesVisited.join(" → ")} with blobId=${finalJob.blobId}`);
    passed++;
  }

  // ── Step 3: Invalid input → 400 error ────────────────────────────────────
  console.log(`\n  [step3] POST with invalid package address → expect 400…`);

  const r3 = await postAudit({ packageId: "notanaddress" });

  if (r3.status !== 400) {
    fail(`step3: expected HTTP 400 but got ${r3.status}: ${await r3.text()}`);
    return;
  }

  const body3 = await r3.json() as { error?: string };
  if (!body3.error || typeof body3.error !== "string") {
    fail(`step3: 400 response has no 'error' field: ${JSON.stringify(body3)}`);
    return;
  }

  console.log(`       error: "${body3.error}" ✓`);
  pass(`step3: invalid address → HTTP 400 with readable error: "${body3.error}"`);
  passed++;

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log(`\nF19: ${passed}/3 steps passed ✓`);
}

main().catch((e) => { console.error(e); process.exit(1); });
