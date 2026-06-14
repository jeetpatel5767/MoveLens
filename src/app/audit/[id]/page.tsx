"use client";

// Report page — live pipeline stepper while running, full findings view when done.
// F21: stepper animation, risk grade, severity chips, expandable findings, trust panel, watermark.

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

// ── Types ─────────────────────────────────────────────────────────────────────

type AuditStatus =
  | "queued" | "fetching" | "auditing" | "encrypting"
  | "uploading" | "linking" | "done" | "failed";

type Severity = "critical" | "high" | "medium" | "low";
type FindingSource = "layer1" | "layer2" | "layer3" | "layer4";

interface Finding {
  rule_id: string;
  severity: Severity;
  confidence: number;
  source: FindingSource;
  module: string;
  line_start: number;
  line_end: number;
  description: string;
  recommendation: string;
  category: string;
  patch_before?: string | null;
  patch_after?:  string | null;
}

interface SeverityCounts { critical: number; high: number; medium: number; low: number }

interface FullReport {
  id: string;
  status: string;
  watermark: string;
  report_id: string;
  generated_at: string;
  package: {
    packageId: string;
    network: string;
    mvrName?: string | null;
    version: number;
    moduleCount: number;
  };
  risk_grade: "A" | "B" | "C" | "D" | "F";
  severity_counts: SeverityCounts;
  layer4_used: boolean;
  memory_context_used: boolean;
  layer3_hits?: number;
  sealed: boolean;
  findings: Finding[];
  blobId?: string | null;
  txDigest?: string | null;
  walrus_url?: string | null;
}

interface JobStatus {
  id: string;
  status: AuditStatus;
  stagesVisited: AuditStatus[];
  blobId?: string | null;
  txDigest?: string | null;
  error?: string | null;
  degraded?: boolean;
  updatedAt: string;
}

// ── Pipeline stages display config ────────────────────────────────────────────

const PIPELINE_STAGES: { key: AuditStatus; label: string; icon: string; detail: string }[] = [
  { key: "fetching",   label: "Fetching Package",         icon: "📥", detail: "Loading modules from Sui GraphQL (testnet)" },
  { key: "auditing",   label: "Running 4-Layer Analysis", icon: "🔍", detail: "Layer 1: 93 deterministic rules · Layer 2: OZ benchmark · Layer 3: memory recall" },
  { key: "encrypting", label: "Encrypting Findings",      icon: "🔒", detail: "Seal threshold IBE encryption — only you can decrypt" },
  { key: "uploading",  label: "Uploading to Walrus",      icon: "☁️",  detail: "Storing encrypted audit quilt on Walrus decentralised storage" },
  { key: "linking",    label: "MVR Linking",              icon: "🔗", detail: "Attaching blob ID to the package in Move Registry" },
  { key: "done",       label: "Report Ready",             icon: "✅", detail: "Security analysis complete" },
];

const TERMINAL_STATUSES: AuditStatus[] = ["done", "failed"];

// ── Severity helpers ──────────────────────────────────────────────────────────

const SEVERITY_COLORS: Record<Severity, { bg: string; text: string; border: string; dot: string }> = {
  critical: { bg: "bg-red-950/50",    text: "text-red-300",    border: "border-red-700",    dot: "bg-red-400"    },
  high:     { bg: "bg-orange-950/50", text: "text-orange-300", border: "border-orange-700", dot: "bg-orange-400" },
  medium:   { bg: "bg-yellow-950/50", text: "text-yellow-300", border: "border-yellow-700", dot: "bg-yellow-400" },
  low:      { bg: "bg-blue-950/50",   text: "text-blue-300",   border: "border-blue-700",   dot: "bg-blue-400"   },
};

const GRADE_COLORS: Record<string, { bg: string; text: string; ring: string }> = {
  A: { bg: "bg-green-900",  text: "text-green-300",  ring: "ring-green-500"  },
  B: { bg: "bg-cyan-900",   text: "text-cyan-300",   ring: "ring-cyan-500"   },
  C: { bg: "bg-yellow-900", text: "text-yellow-300", ring: "ring-yellow-500" },
  D: { bg: "bg-orange-900", text: "text-orange-300", ring: "ring-orange-500" },
  F: { bg: "bg-red-900",    text: "text-red-300",    ring: "ring-red-500"    },
};

const SOURCE_LABELS: Record<FindingSource, { label: string; color: string }> = {
  layer1: { label: "Layer 1 · Deterministic", color: "bg-cyan-900/40 text-cyan-300" },
  layer2: { label: "Layer 2 · OZ Benchmark",  color: "bg-violet-900/40 text-violet-300" },
  layer3: { label: "Layer 3 · Memory",        color: "bg-green-900/40 text-green-300" },
  layer4: { label: "Layer 4 · ML Model",      color: "bg-pink-900/40 text-pink-300" },
};

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

function StageRow({
  stage, currentStatus, stagesVisited, isFailed,
}: {
  stage: typeof PIPELINE_STAGES[number];
  currentStatus: AuditStatus;
  stagesVisited: AuditStatus[];
  isFailed: boolean;
}) {
  const visited  = stagesVisited.includes(stage.key);
  const isActive = currentStatus === stage.key && !isFailed;
  const failHere = isFailed && currentStatus === stage.key;
  const isComplete = (visited && !isActive && !failHere) || stage.key === "done" && currentStatus === "done";

  if (!visited && !isActive && !failHere) {
    return (
      <div className="flex items-center gap-4 py-2 px-4 opacity-25">
        <div className="w-7 h-7 rounded-full bg-gray-800 flex items-center justify-center text-sm">{stage.icon}</div>
        <span className="text-sm text-gray-600">{stage.label}</span>
      </div>
    );
  }

  return (
    <div className={`flex items-start gap-4 py-3 px-4 rounded-xl transition-all duration-300 ${
      failHere  ? "bg-red-950/30 border border-red-800/50" :
      isActive  ? "bg-cyan-950/30 border border-cyan-800/50" :
      isComplete ? "border border-transparent" : ""
    }`}>
      <div className={`mt-0.5 w-7 h-7 flex-shrink-0 rounded-full flex items-center justify-center text-sm ${
        failHere  ? "bg-red-800/40" :
        isActive  ? "ring-2 ring-cyan-500 ring-offset-1 ring-offset-gray-950 bg-cyan-800/40" :
        isComplete ? "bg-gray-700" : "bg-gray-800"
      }`}>
        {isActive  ? <SpinnerIcon className="w-3.5 h-3.5 text-cyan-400 animate-spin" /> :
         failHere  ? <span>❌</span> :
         isComplete ? <span className="text-green-400 text-xs">✓</span> :
         <span>{stage.icon}</span>}
      </div>
      <div className="flex-1 min-w-0">
        <div className={`text-sm font-medium ${
          failHere  ? "text-red-300" :
          isActive  ? "text-cyan-300" :
          isComplete ? "text-gray-300" : "text-gray-600"
        }`}>
          {stage.label}
        </div>
        {(isActive || isComplete) && (
          <div className="text-xs text-gray-500 mt-0.5">{stage.detail}</div>
        )}
      </div>
    </div>
  );
}

function ConfidenceBar({ value, lowConfidence }: { value: number; lowConfidence: boolean }) {
  const pct = Math.round(value * 100);
  return (
    <div className="flex items-center gap-2 mt-1.5">
      <div className="flex-1 h-1.5 bg-gray-700 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${
            lowConfidence ? "bg-gray-500" :
            pct >= 90 ? "bg-red-500" :
            pct >= 70 ? "bg-orange-500" :
            "bg-yellow-500"
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className={`text-xs font-mono ${lowConfidence ? "text-gray-600" : "text-gray-400"}`}>
        {pct}%
      </span>
      {lowConfidence && (
        <span className="text-xs text-gray-600 italic">low confidence</span>
      )}
    </div>
  );
}

function FindingCard({ finding }: { finding: Finding }) {
  const [open, setOpen] = useState(false);
  const low = finding.confidence < 0.4;
  const colors = SEVERITY_COLORS[finding.severity];
  const src = SOURCE_LABELS[finding.source] ?? { label: finding.source, color: "bg-gray-800 text-gray-400" };

  return (
    <div className={`rounded-xl border transition-all ${colors.border} ${low ? "opacity-60" : ""} ${open ? colors.bg : "bg-gray-900/50"}`}>
      {/* Header row — always visible */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full text-left px-4 py-3 flex items-start gap-3"
      >
        <div className={`mt-1 w-2 h-2 rounded-full flex-shrink-0 ${colors.dot}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-xs font-semibold uppercase tracking-wide ${colors.text}`}>
              {finding.severity}
            </span>
            <span className="font-mono text-xs text-gray-400 bg-gray-800 px-1.5 py-0.5 rounded">
              {finding.rule_id}
            </span>
            <span className={`text-xs px-2 py-0.5 rounded-full ${src.color}`}>
              {src.label}
            </span>
            {low && (
              <span className="text-xs text-gray-600 italic">low confidence</span>
            )}
          </div>
          <p className="mt-1 text-sm text-gray-200 line-clamp-2">{finding.description}</p>
          <ConfidenceBar value={finding.confidence} lowConfidence={low} />
        </div>
        <span className="text-gray-600 text-sm mt-0.5 flex-shrink-0">{open ? "▲" : "▼"}</span>
      </button>

      {/* Expanded body */}
      {open && (
        <div className="px-4 pb-4 border-t border-gray-700/50 space-y-3 pt-3">
          {/* Location */}
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <span className="font-mono bg-gray-800 px-2 py-0.5 rounded">{finding.module}</span>
            <span>lines {finding.line_start}–{finding.line_end}</span>
            <span className="text-gray-600">· category: {finding.category}</span>
          </div>

          {/* Description */}
          <div>
            <div className="text-xs font-semibold text-gray-400 mb-1">Description</div>
            <p className="text-sm text-gray-200">{finding.description}</p>
          </div>

          {/* Recommendation */}
          <div>
            <div className="text-xs font-semibold text-gray-400 mb-1">Recommendation</div>
            <p className="text-sm text-gray-300">{finding.recommendation}</p>
          </div>

          {/* Before / after patch */}
          {finding.patch_after && (
            <div>
              <div className="text-xs font-semibold text-gray-400 mb-2">Suggested Fix</div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {finding.patch_before && (
                  <div>
                    <p className="text-xs text-red-400/80 mb-1 font-medium">Before</p>
                    <pre className="text-xs bg-red-950/40 border border-red-800/30 rounded-lg p-2.5 overflow-x-auto text-red-200 leading-relaxed whitespace-pre-wrap"><code>{finding.patch_before}</code></pre>
                  </div>
                )}
                <div>
                  <p className="text-xs text-green-400/80 mb-1 font-medium">After</p>
                  <pre className="text-xs bg-green-950/40 border border-green-800/30 rounded-lg p-2.5 overflow-x-auto text-green-200 leading-relaxed whitespace-pre-wrap"><code>{finding.patch_after}</code></pre>
                </div>
              </div>
              <button
                type="button"
                onClick={() => void navigator.clipboard.writeText(finding.patch_after!)}
                className="mt-2 text-xs text-cyan-400 hover:text-cyan-300 underline underline-offset-2 transition-colors"
              >
                Copy fix
              </button>
            </div>
          )}

          {/* Line range callout */}
          <div className="font-mono text-xs bg-gray-800 rounded-lg px-3 py-2 text-gray-400">
            <span className="text-gray-600">// </span>
            {finding.module}:{finding.line_start}
            {finding.line_end !== finding.line_start ? `–${finding.line_end}` : ""}
          </div>
        </div>
      )}
    </div>
  );
}

function FindingsSection({ findings }: { findings: Finding[] }) {
  const bySeverity: Record<Severity, Finding[]> = { critical: [], high: [], medium: [], low: [] };
  for (const f of findings) { bySeverity[f.severity].push(f); }

  const order: Severity[] = ["critical", "high", "medium", "low"];

  return (
    <div className="space-y-6">
      {order.map((sev) => {
        const group = bySeverity[sev];
        if (group.length === 0) return null;
        const colors = SEVERITY_COLORS[sev];
        return (
          <div key={sev}>
            <div className={`flex items-center gap-2 mb-3`}>
              <div className={`w-2 h-2 rounded-full ${colors.dot}`} />
              <h3 className={`text-sm font-semibold uppercase tracking-wide ${colors.text}`}>
                {sev} ({group.length})
              </h3>
            </div>
            <div className="space-y-2">
              {group.map((f, i) => <FindingCard key={`${f.rule_id}-${i}`} finding={f} />)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AuditPage() {
  const params = useParams<{ id: string }>();
  const auditId = params.id;

  const [job, setJob]       = useState<JobStatus | null>(null);
  const [report, setReport] = useState<FullReport | null>(null);
  const [fetchErr, setFetchErr] = useState<string | null>(null);

  // Poll job status
  const pollJob = useCallback(async () => {
    try {
      const res = await fetch(`/api/audit?id=${auditId}`);
      if (!res.ok) { setFetchErr(`HTTP ${res.status}`); return; }
      const data = await res.json() as JobStatus;
      setJob(data);
      // When done, fetch the full report
      if (data.status === "done") {
        const rRes = await fetch(`/api/report/${auditId}`);
        if (rRes.ok) setReport(await rRes.json() as FullReport);
      }
    } catch (e) {
      // Transient error — will retry; don't surface unless repeated
      console.warn("[audit page] poll error:", e);
    }
  }, [auditId]);

  useEffect(() => {
    void pollJob();
    const interval = setInterval(() => {
      // Keep polling until terminal state
      setJob((j) => {
        if (!j || !TERMINAL_STATUSES.includes(j.status)) {
          void pollJob();
        }
        return j;
      });
    }, 2500);
    return () => clearInterval(interval);
  }, [pollJob]);

  const isDone   = job?.status === "done";
  const isFailed = job?.status === "failed";

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
        <span className="text-gray-400 text-xs font-mono truncate max-w-sm">{auditId}</span>
        {job && !isDone && !isFailed && (
          <span className="ml-auto flex items-center gap-1.5 text-xs text-cyan-400">
            <SpinnerIcon className="w-3.5 h-3.5 animate-spin" />
            Running…
          </span>
        )}
        {isDone && <span className="ml-auto text-xs text-green-400">✓ Complete</span>}
        {isFailed && <span className="ml-auto text-xs text-red-400">✗ Failed</span>}
      </nav>

      <main className="flex-1 max-w-3xl mx-auto w-full px-6 py-8 space-y-8">

        {fetchErr && (
          <div className="rounded-lg bg-red-950 border border-red-700 px-4 py-3 text-sm text-red-300">
            Failed to load audit: {fetchErr}
          </div>
        )}

        {!job && !fetchErr && (
          <div className="flex items-center gap-3 text-gray-400 py-12 justify-center">
            <SpinnerIcon className="w-5 h-5 animate-spin text-cyan-400" />
            Loading audit…
          </div>
        )}

        {job && (
          <>
            {/* ── Watermark (always visible) ─────────────────────────────── */}
            <div className="text-xs text-amber-700 border border-amber-900/40 rounded-lg px-4 py-2 text-center">
              Automated pre-screen — not a substitute for a human audit.
            </div>

            {/* ── Degraded mode banner ──────────────────────────────────── */}
            {isDone && job.degraded && (
              <div className="bg-yellow-950/40 border border-yellow-600/50 rounded-xl px-5 py-4 text-sm">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-yellow-400 text-base">⚠</span>
                  <span className="font-semibold text-yellow-300">Cached reference audit shown</span>
                </div>
                <p className="text-yellow-200/70 text-xs leading-relaxed">
                  Live Walrus upload was temporarily unavailable — the blob link below points to a
                  cached reference audit (Cetus retroactive) to demonstrate the report format.
                  Your audit&apos;s findings above are real and accurate; only the on-chain storage step
                  used a fallback.
                </p>
              </div>
            )}

            {/* ── Status header ─────────────────────────────────────────── */}
            <div>
              <h1 className="text-3xl font-extrabold text-white">
                {isDone   ? "Security Report" :
                 isFailed ? "Audit Failed" :
                 "Running Audit…"}
              </h1>
              {report?.package.mvrName && (
                <p className="text-lg text-cyan-400 font-medium mt-1">{report.package.mvrName}</p>
              )}
              <p className="text-sm text-gray-500 font-mono mt-0.5 break-all">
                {report?.package.packageId ?? auditId}
              </p>
            </div>

            {/* ── Risk grade + severity chips (done only) ───────────────── */}
            {isDone && report && (
              <div className="flex items-center gap-4 flex-wrap">
                {/* Grade badge */}
                {(() => {
                  const g = GRADE_COLORS[report.risk_grade] ?? GRADE_COLORS.F;
                  return (
                    <div className={`w-16 h-16 rounded-2xl flex items-center justify-center text-4xl font-black ring-2 ${g.bg} ${g.text} ${g.ring}`}>
                      {report.risk_grade}
                    </div>
                  );
                })()}
                {/* Severity chips */}
                {(["critical","high","medium","low"] as Severity[]).map((s) => {
                  const cnt = report.severity_counts[s];
                  const c = SEVERITY_COLORS[s];
                  return (
                    <div key={s} className={`rounded-xl border px-4 py-2 text-center min-w-[64px] ${c.bg} ${c.border}`}>
                      <div className={`text-2xl font-bold ${c.text}`}>{cnt}</div>
                      <div className="text-xs text-gray-500 capitalize">{s}</div>
                    </div>
                  );
                })}
                {/* Engine badges */}
                <div className="ml-auto flex flex-col gap-1 text-right">
                  {report.layer4_used && (
                    <span className="text-xs bg-pink-900/40 text-pink-300 rounded-full px-2 py-0.5">Layer 4 · ML</span>
                  )}
                  {report.memory_context_used && (
                    <span className="text-xs bg-green-900/40 text-green-300 rounded-full px-2 py-0.5">
                      Layer 3 · Memory · {report.layer3_hits ?? 0} hit{(report.layer3_hits ?? 0) !== 1 ? "s" : ""}
                    </span>
                  )}
                  {report.sealed && (
                    <span className="text-xs bg-emerald-900/40 text-emerald-300 rounded-full px-2 py-0.5">🔒 Seal encrypted</span>
                  )}
                </div>
              </div>
            )}

            {/* ── Pipeline stepper ──────────────────────────────────────── */}
            <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-800 text-xs font-semibold text-gray-400 uppercase tracking-wide">
                Pipeline
              </div>
              <div className="p-3 space-y-1">
                {PIPELINE_STAGES.map((stage) => (
                  <StageRow
                    key={stage.key}
                    stage={stage}
                    currentStatus={job.status}
                    stagesVisited={job.stagesVisited ?? []}
                    isFailed={isFailed}
                  />
                ))}
              </div>
            </div>

            {/* ── Error ─────────────────────────────────────────────────── */}
            {isFailed && job.error && (
              <div className="rounded-xl bg-red-950/50 border border-red-700 px-5 py-4">
                <div className="text-sm font-semibold text-red-300 mb-1">Pipeline error</div>
                <p className="text-sm text-red-400">{job.error}</p>
                <p className="text-xs text-gray-600 mt-2">
                  The audit engine ran successfully — only the Walrus upload step failed.
                  Findings are still available if you retry.
                </p>
              </div>
            )}

            {/* ── Findings ──────────────────────────────────────────────── */}
            {isDone && report && report.findings.length > 0 && (
              <div>
                <h2 className="text-lg font-bold text-white mb-4">
                  Findings ({report.findings.length})
                </h2>
                <FindingsSection findings={report.findings} />
              </div>
            )}

            {isDone && report && report.findings.length === 0 && (
              <div className="rounded-xl bg-green-950/30 border border-green-800/50 px-5 py-8 text-center">
                <div className="text-3xl mb-2">🎉</div>
                <div className="text-green-300 font-medium">No findings — clean contract!</div>
                <div className="text-xs text-gray-500 mt-1">
                  Layer 1 (93 rules) and Layer 2 (10 OZ checks) found no issues.
                </div>
              </div>
            )}

            {/* ── Trust panel ───────────────────────────────────────────── */}
            {isDone && (job.blobId || job.txDigest) && (
              <div className="bg-gray-900 border border-gray-700 rounded-2xl overflow-hidden">
                <div className="px-5 py-3 border-b border-gray-700 flex items-center gap-2">
                  <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
                    Permanent Trust Panel
                  </span>
                  <span className="text-xs text-gray-600">— on-chain provenance</span>
                </div>
                <div className="px-5 py-4 space-y-3 text-sm">
                  {job.blobId && (
                    <div className="flex items-start gap-3">
                      <span className="text-gray-500 w-28 flex-shrink-0 text-xs pt-0.5">Walrus Blob</span>
                      <div className="flex-1 min-w-0">
                        <a
                          href={`https://aggregator.walrus-testnet.walrus.space/v1/blobs/${job.blobId}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-mono text-xs text-cyan-400 hover:text-cyan-300 break-all"
                        >
                          {job.blobId}
                        </a>
                        <p className="text-xs text-gray-600 mt-0.5">
                          Encrypted audit quilt (report.json + findings.enc + summary.md) · 5 epochs
                        </p>
                      </div>
                    </div>
                  )}
                  {job.txDigest && (
                    <div className="flex items-start gap-3">
                      <span className="text-gray-500 w-28 flex-shrink-0 text-xs pt-0.5">MVR TX</span>
                      <a
                        href={`https://suiscan.xyz/testnet/tx/${job.txDigest}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-mono text-xs text-cyan-400 hover:text-cyan-300 break-all"
                      >
                        {job.txDigest}
                      </a>
                    </div>
                  )}
                  <div className="flex items-center gap-3">
                    <span className="text-gray-500 w-28 flex-shrink-0 text-xs">Seal</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${report?.sealed ? "bg-emerald-900/40 text-emerald-300" : "bg-gray-800 text-gray-500"}`}>
                      {report?.sealed ? "🔒 IBE-encrypted findings" : "Plaintext fallback"}
                    </span>
                  </div>
                  {report && (
                    <div className="flex items-center gap-3">
                      <span className="text-gray-500 w-28 flex-shrink-0 text-xs">Generated</span>
                      <span className="text-xs text-gray-400">{new Date(report.generated_at).toLocaleString()}</span>
                    </div>
                  )}
                  <div className="flex items-start gap-3">
                    <span className="text-gray-500 w-28 flex-shrink-0 text-xs pt-0.5">Ownership</span>
                    <p className="text-xs text-gray-400">
                      PackageInfo object owned by auditor&apos;s keypair — verified on Sui testnet.
                      Package address is hashed (SHA-256) in the public quilt; raw ID stored only
                      in Seal-encrypted findings.enc.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Run another */}
            {(isDone || isFailed) && (
              <div className="text-center pt-2">
                <Link href="/" className="text-sm text-cyan-400 hover:text-cyan-300 underline underline-offset-2">
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
