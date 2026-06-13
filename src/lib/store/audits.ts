// src/lib/store/audits.ts
// SQLite-backed audit job store — jobs survive dev server restarts.
//
// HARD RULES:
//   - No paid AI API calls anywhere.
//   - No JSON-RPC.
//   - A failed stage MUST set status="failed" and error=<readable string>.

import Database from "better-sqlite3";
import path from "path";
import type { AuditReport } from "../audit/schema";

// ── Status machine ────────────────────────────────────────────────────────────

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
  id: string;
  status: AuditStatus;
  stagesVisited: AuditStatus[];
  report?: AuditReport;
  blobId?: string;
  txDigest?: string | null;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

// ── SQLite schema ──────────────────────────────────────────────────────────────

interface DbRow {
  id:             string;
  status:         string;
  stages_visited: string;
  report:         string | null;
  blob_id:        string | null;
  tx_digest:      string | null;
  error:          string | null;
  created_at:     string;
  updated_at:     string;
}

const DDL = `
  CREATE TABLE IF NOT EXISTS audit_jobs (
    id             TEXT PRIMARY KEY,
    status         TEXT NOT NULL,
    stages_visited TEXT NOT NULL,
    report         TEXT,
    blob_id        TEXT,
    tx_digest      TEXT,
    error          TEXT,
    created_at     TEXT NOT NULL,
    updated_at     TEXT NOT NULL
  )
`;

// ── DB path (exported for tests) ──────────────────────────────────────────────

export const DB_PATH = path.join(process.cwd(), "audits.db");
const MAX_AGE_MS   = 24 * 60 * 60 * 1000;

// ── Serialisation helpers ─────────────────────────────────────────────────────

function rowToJob(row: DbRow): AuditJob {
  return {
    id:            row.id,
    status:        row.status as AuditStatus,
    stagesVisited: JSON.parse(row.stages_visited) as AuditStatus[],
    report:        row.report ? (JSON.parse(row.report) as AuditReport) : undefined,
    blobId:        row.blob_id  ?? undefined,
    txDigest:      row.tx_digest ?? undefined,
    error:         row.error    ?? undefined,
    createdAt:     row.created_at,
    updatedAt:     row.updated_at,
  };
}

function jobToValues(job: AuditJob): DbRow {
  return {
    id:             job.id,
    status:         job.status,
    stages_visited: JSON.stringify(job.stagesVisited),
    report:         job.report    ? JSON.stringify(job.report) : null,
    blob_id:        job.blobId    ?? null,
    tx_digest:      job.txDigest  ?? null,
    error:          job.error     ?? null,
    created_at:     job.createdAt,
    updated_at:     job.updatedAt,
  };
}

// ── SQLite singleton ───────────────────────────────────────────────────────────

let _db: Database.Database | null = null;

function openDb(dbPath = DB_PATH): Database.Database {
  if (_db) return _db;
  _db = new Database(dbPath);
  _db.pragma("journal_mode = WAL");
  _db.exec(DDL);
  return _db;
}

// Prepared statements (lazily created after openDb())
let _upsert:   Database.Statement | null = null;
let _getById:  Database.Statement | null = null;
let _getAll:   Database.Statement | null = null;
let _prune:    Database.Statement | null = null;

function stmts(d: Database.Database) {
  if (!_upsert) {
    _upsert = d.prepare(`
      INSERT OR REPLACE INTO audit_jobs
        (id, status, stages_visited, report, blob_id, tx_digest, error, created_at, updated_at)
      VALUES
        ($id, $status, $stages_visited, $report, $blob_id, $tx_digest, $error, $created_at, $updated_at)
    `);
    _getById = d.prepare("SELECT * FROM audit_jobs WHERE id = ?");
    _getAll  = d.prepare("SELECT * FROM audit_jobs");
    _prune   = d.prepare("DELETE FROM audit_jobs WHERE created_at < ?");
  }
  return { upsert: _upsert!, getById: _getById!, getAll: _getAll!, prune: _prune! };
}

// ── In-memory mirror (fast reads) ────────────────────────────────────────────

const jobs = new Map<string, AuditJob>();

// ── Pruning (exported for tests) ──────────────────────────────────────────────

/**
 * Delete jobs older than 24 hours from the given database.
 * Exported for test/f34-verify.ts.
 */
export function pruneOldJobs(d: Database.Database): number {
  const cutoff = new Date(Date.now() - MAX_AGE_MS).toISOString();
  return d.prepare("DELETE FROM audit_jobs WHERE created_at < ?").run(cutoff).changes;
}

// ── Startup ───────────────────────────────────────────────────────────────────

function initStore(): void {
  const d = openDb();
  const { getAll } = stmts(d);

  const pruned = pruneOldJobs(d);
  if (pruned > 0) console.log(`[store] Pruned ${pruned} old audit job(s) (>24h)`);

  jobs.clear();
  for (const row of getAll.all() as DbRow[]) {
    jobs.set(row.id, rowToJob(row));
  }
  console.log(`[store] Loaded ${jobs.size} job(s) from audits.db`);
}

initStore();

// ── Public API ────────────────────────────────────────────────────────────────

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
  const d = openDb();
  stmts(d).upsert.run(jobToValues(job));
  return job;
}

export function getJob(id: string): AuditJob | undefined {
  return jobs.get(id);
}

export function updateJob(
  job: AuditJob,
  patch: Partial<Omit<AuditJob, "id" | "createdAt">>,
): void {
  if (patch.status && patch.status !== job.status) {
    job.stagesVisited = [...job.stagesVisited, patch.status];
  }
  Object.assign(job, { ...patch, updatedAt: new Date().toISOString() });
  const d = openDb();
  stmts(d).upsert.run(jobToValues(job));
}

export function listJobIds(): string[] {
  return [...jobs.keys()];
}
