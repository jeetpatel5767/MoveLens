"use client";

// Report page — live pipeline stepper while running, full findings when done.
// F20: this page just needs to exist so the landing page can navigate here.
// F21: will add the full stepper + findings view.

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

// ── Types ─────────────────────────────────────────────────────────────────────

type AuditStatus =
  | "queued" | "fetching" | "auditing" | "encrypting"
  | "uploading" | "linking" | "done" | "failed";

interface JobStatus {
  id: string;
  status: AuditStatus;
  stagesVisited: AuditStatus[];
  blobId?: string | null;
  txDigest?: string | null;
  error?: string | null;
  updatedAt: string;
}

// ── Pipeline stepper config ───────────────────────────────────────────────────

const STAGES: { key: AuditStatus; label: string; icon: string; detail: string }[] = [
  { key: "fetching",   label: "Fetching Package",   icon: "📥", detail: "Fetching package modules from Sui GraphQL" },
  { key: "auditing",   label: "Running Audit",       icon: "🔍", detail: "4-layer hybrid engine: deterministic rules + OZ benchmark" },
  { key: "encrypting", label: "Encrypting Report",   icon: "🔒", detail: "Seal threshold encryption for findings privacy" },
  { key: "uploading",  label: "Uploading to Walrus", icon: "☁️",  detail: "Storing encrypted audit quilt on Walrus testnet" },
  { key: "linking",    label: "MVR Linking",         icon: "🔗", detail: "Attaching blob ID to package in Move Registry" },
  { key: "done",       label: "Report Ready",        icon: "✅", detail: "Audit complete — findings available below" },
];

const STATUS_ORDER: AuditStatus[] = [
  "queued", "fetching", "auditing", "encrypting", "uploading", "linking", "done", "failed",
];

function stageIndex(s: AuditStatus) { return STATUS_ORDER.indexOf(s); }

// ── Sub-components ────────────────────────────────────────────────────────────

function ShieldIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4" />
    </svg>
  );
}

function SpinnerIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
    </svg>
  );
}

function StepRow({
  stage, currentStatus, stagesVisited, failed,
}: {
  stage: typeof STAGES[number];
  currentStatus: AuditStatus;
  stagesVisited: AuditStatus[];
  failed: boolean;
}) {
  const visited = stagesVisited.includes(stage.key);
  const isActive = currentStatus === stage.key;
  const isFailed = failed && isActive;
  const isDone = visited && !isActive || stage.key === "done" && currentStatus === "done";

  return (
    <div className={`flex items-start gap-4 py-3 px-4 rounded-xl transition-all ${
      isActive && !isFailed ? "bg-cyan-950/30 border border-cyan-800/50" :
      isFailed ? "bg-red-950/30 border border-red-800/50" :
      isDone ? "opacity-60" : "opacity-30"
    }`}>
      <div className={`mt-0.5 w-8 h-8 flex-shrink-0 rounded-full flex items-center justify-center text-lg ${
        isFailed ? "bg-red-700/30" :
        isDone ? "bg-cyan-900/40" :
        isActive ? "bg-cyan-800/50 ring-2 ring-cyan-500 ring-offset-1 ring-offset-gray-950" :
        "bg-gray-800"
      }`}>
        {isActive && !isFailed
          ? <SpinnerIcon className="w-4 h-4 text-cyan-400 animate-spin" />
          : isFailed ? "❌"
          : isDone ? "✓"
          : stage.icon}
      </div>
      <div>
        <div className={`text-sm font-medium ${
          isFailed ? "text-red-300" :
          isActive ? "text-cyan-300" :
          isDone ? "text-gray-300" :
          "text-gray-600"
        }`}>
          {stage.label}
        </div>
        {(isActive || isDone) && (
          <div className="text-xs text-gray-500 mt-0.5">{stage.detail}</div>
        )}
      </div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function AuditPage() {
  const params = useParams<{ id: string }>();
  const auditId = params.id;

  const [job, setJob] = useState<JobStatus | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const poll = useCallback(async () => {
    try {
      const res = await fetch(`/api/audit?id=${auditId}`);
      if (!res.ok) {
        setFetchError(`HTTP ${res.status}`);
        return;
      }
      const data = await res.json() as JobStatus;
      setJob(data);
    } catch (e) {
      // Transient network error — will retry on next tick
      console.warn("[audit page] poll error:", e);
    }
  }, [auditId]);

  useEffect(() => {
    void poll();
    const interval = setInterval(() => {
      if (job?.status !== "done" && job?.status !== "failed") {
        void poll();
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [poll, job?.status]);

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex flex-col">

      {/* Nav */}
      <nav className="border-b border-gray-800 px-6 py-3 flex items-center gap-3">
        <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
          <ShieldIcon className="w-5 h-5 text-cyan-400" />
          <span className="font-bold text-white">MoveLens</span>
        </Link>
        <span className="text-gray-600">/</span>
        <span className="text-gray-400 text-sm font-mono truncate max-w-xs">{auditId}</span>
      </nav>

      <main className="flex-1 max-w-2xl mx-auto w-full px-6 py-10">

        {fetchError && (
          <div className="rounded-lg bg-red-950 border border-red-700 px-4 py-3 text-sm text-red-300 mb-6">
            Failed to load audit job: {fetchError}
          </div>
        )}

        {!job && !fetchError && (
          <div className="flex items-center gap-3 text-gray-400">
            <SpinnerIcon className="w-5 h-5 animate-spin text-cyan-400" />
            Loading audit job…
          </div>
        )}

        {job && (
          <>
            {/* Watermark */}
            <div className="text-xs text-amber-700 border border-amber-900/50 rounded-lg px-3 py-2 mb-6 text-center">
              Automated pre-screen — not a substitute for a human audit.
            </div>

            {/* Status header */}
            <div className="mb-6">
              <h1 className="text-2xl font-bold text-white mb-1">
                {job.status === "done" ? "Audit Complete" :
                 job.status === "failed" ? "Audit Failed" :
                 "Audit Running…"}
              </h1>
              <p className="text-sm text-gray-500 font-mono">{auditId}</p>
            </div>

            {/* Pipeline stepper */}
            <div className="space-y-1 mb-8">
              {STAGES.map((stage) => (
                <StepRow
                  key={stage.key}
                  stage={stage}
                  currentStatus={job.status}
                  stagesVisited={job.stagesVisited ?? []}
                  failed={job.status === "failed"}
                />
              ))}
            </div>

            {/* Error */}
            {job.status === "failed" && job.error && (
              <div className="rounded-lg bg-red-950/50 border border-red-700 px-4 py-3 text-sm text-red-300 mb-6">
                <div className="font-medium mb-1">Error</div>
                {job.error}
              </div>
            )}

            {/* Trust panel (done only) */}
            {job.status === "done" && job.blobId && (
              <div className="rounded-xl bg-gray-900 border border-gray-700 p-5 space-y-3">
                <h2 className="text-sm font-semibold text-gray-300">Permanent Trust Panel</h2>
                <div className="text-xs space-y-2">
                  <div className="flex items-start gap-2">
                    <span className="text-gray-500 w-24 flex-shrink-0">Walrus Blob</span>
                    <a
                      href={`https://aggregator.walrus-testnet.walrus.space/v1/blobs/${job.blobId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-cyan-400 hover:text-cyan-300 break-all"
                    >
                      {job.blobId}
                    </a>
                  </div>
                  {job.txDigest && (
                    <div className="flex items-start gap-2">
                      <span className="text-gray-500 w-24 flex-shrink-0">MVR TX</span>
                      <a
                        href={`https://suiscan.xyz/testnet/tx/${job.txDigest}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-mono text-cyan-400 hover:text-cyan-300 break-all"
                      >
                        {job.txDigest}
                      </a>
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <span className="text-gray-500 w-24">Seal</span>
                    <span className="text-green-400">Encrypted draft — findings Seal-protected</span>
                  </div>
                </div>
              </div>
            )}

            {/* Run another audit */}
            {(job.status === "done" || job.status === "failed") && (
              <div className="mt-6 text-center">
                <Link
                  href="/"
                  className="text-sm text-cyan-400 hover:text-cyan-300 underline underline-offset-2"
                >
                  ← Run another audit
                </Link>
              </div>
            )}
          </>
        )}

      </main>

      <footer className="border-t border-gray-800 py-3 px-6 text-center text-xs text-gray-600">
        Automated pre-screen — not a substitute for a human audit. · Sui Overflow 2026 · Walrus Track
      </footer>
    </div>
  );
}
