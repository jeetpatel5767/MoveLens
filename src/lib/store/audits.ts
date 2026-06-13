// src/lib/store/audits.ts
// In-process audit job store — no database for MVP hackathon demo.
//
// HARD RULES:
//   - No paid AI API calls anywhere.
//   - No JSON-RPC.
//   - Jobs live in a Map for the lifetime of the server process.
//   - A failed stage MUST set status="failed" and error=<readable string>.

import type { AuditReport } from "../audit/schema";

// ── Status machine ────────────────────────────────────────────────────────────

/**
 * Linear pipeline stages. Each stage is set BEFORE the corresponding async
 * work starts, so the frontend always sees forward progress.
 *
 * queued    — job created, pipeline not yet started
 * fetching  — fetching package from Sui GraphQL (or parsing source upload)
 * auditing  — running 4-layer audit engine
 * encrypting— Seal threshold encryption
 * uploading — uploading quilt to Walrus
 * linking   — attaching blob ID to MVR PackageInfo (demo pkg only)
 * done      — all stages complete; report + blobId available
 * failed    — a stage threw; error contains the human-readable reason
 */
export type AuditStatus =
  | "queued"
  | "fetching"
  | "auditing"
  | "encrypting"
  | "uploading"
  | "linking"
  | "done"
  | "failed";

// ── Job record ─────────────────────────────────────────────────────────────────

export interface AuditJob {
  /** UUID v4 */
  id: string;
  status: AuditStatus;
  /**
   * Every status this job has ever been in, in order.
   * Allows clients that start polling after early fast stages have already
   * completed to still verify those stages ran.
   */
  stagesVisited: AuditStatus[];
  /** Populated once status="done" */
  report?: AuditReport;
  /** Walrus blob ID, set once uploading completes */
  blobId?: string;
  /** MVR set_metadata TX digest, set once linking completes (may be null) */
  txDigest?: string | null;
  /** Human-readable error message (only when status="failed") */
  error?: string;
  /** ISO timestamp when the job was created */
  createdAt: string;
  /** ISO timestamp when the job last changed status */
  updatedAt: string;
}

// ── In-process store ──────────────────────────────────────────────────────────

const jobs = new Map<string, AuditJob>();

/**
 * Create a new queued job and add it to the store.
 */
export function createJob(): AuditJob {
  const now = new Date().toISOString();
  const job: AuditJob = {
    id:            crypto.randomUUID(),
    status:        "queued",
    stagesVisited: ["queued"],
    createdAt:     now,
    updatedAt:     now,
  };
  jobs.set(job.id, job);
  return job;
}

/**
 * Retrieve a job by id. Returns undefined if not found.
 */
export function getJob(id: string): AuditJob | undefined {
  return jobs.get(id);
}

/**
 * Update a job's status (and optional extra fields).
 * Also stamps updatedAt and appends the new status to stagesVisited
 * (so polling clients that miss fast early stages can still verify them).
 */
export function updateJob(
  job: AuditJob,
  patch: Partial<Omit<AuditJob, "id" | "createdAt">>,
): void {
  // Append the new status to stagesVisited before applying the patch
  if (patch.status && patch.status !== job.status) {
    job.stagesVisited = [...job.stagesVisited, patch.status];
  }
  Object.assign(job, { ...patch, updatedAt: new Date().toISOString() });
}

/**
 * Return all job IDs (for health/debug endpoints).
 */
export function listJobIds(): string[] {
  return [...jobs.keys()];
}
