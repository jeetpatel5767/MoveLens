"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { AuroraBackground } from "@/components/landing/home/AuroraBackground";

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
  patch_after?: string | null;
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

// ── Design tokens ─────────────────────────────────────────────────────────────

const SEV: Record<Severity, string> = {
  critical: "#ff5c5c",
  high:     "#ff8b5c",
  medium:   "#ffc15c",
  low:      "#5cc9f5",
};

const GRADE_COLOR: Record<string, string> = {
  A: "#5cffb1", B: "#5ce0ff", C: "#ffc15c", D: "#ff8b5c", F: "#ff5c5c",
};

const GRADE_LABEL: Record<string, string> = {
  A: "Clean", B: "Low Risk", C: "Medium Risk", D: "High Risk", F: "Critical Risk",
};

// Matches /app page form glass exactly
const FORM_GLASS: React.CSSProperties = {
  background: "rgba(10,8,20,0.42)",
  backdropFilter: "blur(64px) saturate(210%) brightness(112%)",
  WebkitBackdropFilter: "blur(64px) saturate(210%) brightness(112%)",
  border: "1px solid rgba(184,180,255,0.14)",
  boxShadow: [
    "0 48px 120px rgba(0,0,0,0.55)",
    "0 12px 40px rgba(0,0,0,0.35)",
    "inset 0 1.5px 0 rgba(255,255,255,0.13)",
    "inset 0 -1px 0 rgba(0,0,0,0.3)",
    "0 0 0 0.5px rgba(184,180,255,0.07)",
  ].join(", "),
};

// Gallery card style from /app page
const GALLERY_CARD: React.CSSProperties = {
  background: "rgba(10,8,20,0.52)",
  backdropFilter: "blur(32px) saturate(180%)",
  WebkitBackdropFilter: "blur(32px) saturate(180%)",
  border: "1px solid rgba(184,180,255,0.13)",
  boxShadow: "0 24px 64px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.06)",
};

const CARD_DIVIDER = "1px solid rgba(184,180,255,0.1)";

const SOURCE: Record<FindingSource, { label: string; color: string; bg: string }> = {
  layer1: { label: "L1 · Rule",   color: "#b8b4ff", bg: "rgba(184,180,255,0.09)" },
  layer2: { label: "L2 · OZ",     color: "#4da2ff", bg: "rgba(77,162,255,0.09)"  },
  layer3: { label: "L3 · Memory", color: "#5cffb1", bg: "rgba(92,255,177,0.09)" },
  layer4: { label: "L4 · ML",     color: "#ff8b5c", bg: "rgba(255,140,92,0.09)" },
};

const TERMINAL: AuditStatus[] = ["done", "failed"];

const STAGE_LABEL: Record<AuditStatus, string> = {
  queued:     "Queued",
  fetching:   "Fetching Package",
  auditing:   "Running Analysis",
  encrypting: "Encrypting Report",
  uploading:  "Uploading to Walrus",
  linking:    "Linking On-Chain",
  done:       "Complete",
  failed:     "Failed",
};

const STAGE_SUB: Record<AuditStatus, string> = {
  queued:     "Waiting for a worker slot…",
  fetching:   "Pulling modules via Sui GraphQL",
  auditing:   "65 rules · OZ benchmarks · LanceDB recall · Groq ML",
  encrypting: "IBE threshold encryption via Seal",
  uploading:  "5-epoch permanent storage",
  linking:    "Writing blob ID via MVR on-chain tx",
  done:       "Report ready",
  failed:     "An error occurred",
};

// ── Spinner ───────────────────────────────────────────────────────────────────

function Spinner({ size = 16, color = "#b8b4ff" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      style={{ animation: "mlSpin 0.9s linear infinite", flexShrink: 0 }}>
      <circle cx="12" cy="12" r="10" stroke={color} strokeWidth="2.5" strokeOpacity="0.2" />
      <path fill={color} d="M4 12a8 8 0 018-8v8H4z" />
    </svg>
  );
}

// ── Severity bar chart (vertical bars) ───────────────────────────────────────

function SeverityBars({ counts }: { counts: SeverityCounts }) {
  const bars = [
    { key: "critical" as Severity, count: counts.critical, label: "Critical" },
    { key: "high"     as Severity, count: counts.high,     label: "High"     },
    { key: "medium"   as Severity, count: counts.medium,   label: "Medium"   },
    { key: "low"      as Severity, count: counts.low,      label: "Low"      },
  ];
  const max = Math.max(...bars.map(b => b.count), 1);
  const BAR_MAX_H = 110;

  return (
    <div style={{ display: "flex", gap: 10, alignItems: "flex-end", height: BAR_MAX_H + 68 }}>
      {bars.map(({ key, count, label }) => {
        const color = SEV[key];
        const h = count > 0 ? Math.max(6, Math.round((count / max) * BAR_MAX_H)) : 3;
        return (
          <div key={key} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", height: "100%", justifyContent: "flex-end" }}>
            <div className="font-display" style={{
              fontSize: 34, fontWeight: 800, letterSpacing: "-0.04em",
              color: count > 0 ? color : "rgba(255,255,255,0.1)",
              lineHeight: 1, marginBottom: 10,
            }}>
              {count}
            </div>
            <div style={{
              width: "100%", height: h,
              background: count > 0 ? color : "rgba(255,255,255,0.05)",
              borderRadius: "5px 5px 0 0",
              opacity: count > 0 ? 0.78 : 1,
              transition: "height 0.9s cubic-bezier(0.4,0,0.2,1)",
            }} />
            <div className="font-display" style={{
              fontSize: 10, color: count > 0 ? color + "99" : "rgba(255,255,255,0.2)",
              textTransform: "uppercase" as const, letterSpacing: "0.1em", marginTop: 9,
            }}>
              {label}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Category horizontal bars ──────────────────────────────────────────────────

function CategoryChart({ findings }: { findings: Finding[] }) {
  const cats = useMemo(() => {
    const m: Record<string, { count: number; topSev: Severity }> = {};
    for (const f of findings) {
      if (!m[f.category]) m[f.category] = { count: 0, topSev: "low" };
      m[f.category].count++;
      const rank: Record<Severity, number> = { critical: 4, high: 3, medium: 2, low: 1 };
      if (rank[f.severity] > rank[m[f.category].topSev]) m[f.category].topSev = f.severity;
    }
    return Object.entries(m).sort((a, b) => b[1].count - a[1].count).slice(0, 8);
  }, [findings]);

  const max = cats[0]?.[1].count ?? 1;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 13 }}>
      {cats.map(([cat, { count, topSev }]) => (
        <div key={cat}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
            <span className="font-mono-plex" style={{ fontSize: 11, color: "rgba(255,255,255,0.38)", letterSpacing: "0.06em" }}>
              {cat.toUpperCase()}
            </span>
            <span className="font-display" style={{ fontSize: 14, fontWeight: 700, color: SEV[topSev] }}>{count}</span>
          </div>
          <div style={{ height: 5, borderRadius: 99, overflow: "hidden", background: "rgba(255,255,255,0.05)" }}>
            <div style={{
              height: "100%", borderRadius: 99,
              width: `${(count / max) * 100}%`,
              background: SEV[topSev], opacity: 0.65,
              transition: "width 0.9s cubic-bezier(0.4,0,0.2,1)",
            }} />
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Finding row ───────────────────────────────────────────────────────────────

function FindingRow({ finding, idx }: { finding: Finding; idx: number }) {
  const [open, setOpen] = useState(false);
  const c   = SEV[finding.severity];
  const src = SOURCE[finding.source] ?? { label: finding.source, color: "rgba(255,255,255,0.4)", bg: "rgba(255,255,255,0.05)" };
  const pct = Math.round(finding.confidence * 100);

  return (
    <div style={{
      border: open ? `1px solid ${c}28` : CARD_DIVIDER,
      borderRadius: 14,
      overflow: "hidden",
      background: open ? `${c}06` : "rgba(10,8,20,0.45)",
      backdropFilter: "blur(24px)",
      WebkitBackdropFilter: "blur(24px)",
      transition: "border-color 0.15s, background 0.15s",
    }}>
      <button type="button" onClick={() => setOpen(v => !v)}
        style={{ width: "100%", textAlign: "left", display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", cursor: "pointer", background: "transparent", border: "none" }}>

        <div style={{ width: 8, height: 8, borderRadius: "50%", background: c, flexShrink: 0, boxShadow: `0 0 8px ${c}70` }} />

        <span className="font-mono-plex" style={{ fontSize: 9.5, color: "rgba(255,255,255,0.2)", width: 18, flexShrink: 0, textAlign: "right" }}>
          {String(idx + 1).padStart(2, "0")}
        </span>

        <span className="font-mono-plex" style={{ fontSize: 11, padding: "2px 7px", borderRadius: 6, background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.4)", flexShrink: 0, whiteSpace: "nowrap" }}>
          {finding.rule_id}
        </span>

        <span className="font-sans-switzer" style={{ fontSize: 13, color: "rgba(255,255,255,0.65)", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {finding.description}
        </span>

        <span className="font-display" style={{ fontSize: 9.5, padding: "2px 8px", borderRadius: 99, background: src.bg, color: src.color, flexShrink: 0, whiteSpace: "nowrap" }}>
          {src.label}
        </span>

        <span className="font-mono-plex" style={{ fontSize: 9.5, color: "rgba(255,255,255,0.18)", flexShrink: 0 }}>:{finding.line_start}</span>

        <span style={{ fontSize: 9, color: "rgba(184,180,255,0.3)", transform: open ? "rotate(180deg)" : "none", transition: "transform 0.18s ease", flexShrink: 0 }}>▼</span>
      </button>

      {open && (
        <div style={{ borderTop: CARD_DIVIDER, padding: "18px 18px 20px", display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span className="font-mono-plex" style={{ fontSize: 11, padding: "3px 9px", borderRadius: 7, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.45)" }}>
              {finding.module}:{finding.line_start}{finding.line_end !== finding.line_start ? `–${finding.line_end}` : ""}
            </span>
            <div style={{ display: "flex", alignItems: "center", gap: 7, flex: 1, minWidth: 120 }}>
              <span className="font-display" style={{ fontSize: 10, color: "rgba(255,255,255,0.22)", whiteSpace: "nowrap" }}>confidence</span>
              <div style={{ flex: 1, height: 2, borderRadius: 99, background: "rgba(255,255,255,0.07)", overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${pct}%`, background: c, opacity: 0.55, transition: "width 0.4s ease", borderRadius: 99 }} />
              </div>
              <span className="font-mono-plex" style={{ fontSize: 10, color: "rgba(255,255,255,0.25)", flexShrink: 0 }}>{pct}%</span>
            </div>
          </div>

          <div>
            <div className="font-display" style={{ fontSize: 10, color: "rgba(184,180,255,0.3)", textTransform: "uppercase" as const, letterSpacing: "0.1em", marginBottom: 6 }}>Description</div>
            <p className="font-sans-switzer" style={{ fontSize: 14, lineHeight: 1.65, color: "rgba(255,255,255,0.55)" }}>{finding.description}</p>
          </div>

          <div>
            <div className="font-display" style={{ fontSize: 10, color: "rgba(184,180,255,0.3)", textTransform: "uppercase" as const, letterSpacing: "0.1em", marginBottom: 6 }}>Recommendation</div>
            <p className="font-sans-switzer" style={{ fontSize: 14, lineHeight: 1.65, color: "rgba(255,255,255,0.55)" }}>{finding.recommendation}</p>
          </div>

          {finding.patch_after && (
            <div>
              <div className="font-display" style={{ fontSize: 10, color: "rgba(184,180,255,0.3)", textTransform: "uppercase" as const, letterSpacing: "0.1em", marginBottom: 10 }}>Suggested Fix</div>
              <div style={{ display: "grid", gridTemplateColumns: finding.patch_before ? "1fr 1fr" : "1fr", gap: 10 }}>
                {finding.patch_before && (
                  <div>
                    <div className="font-display" style={{ fontSize: 9.5, color: SEV.critical, marginBottom: 6, textTransform: "uppercase" as const, letterSpacing: "0.08em" }}>Before</div>
                    <pre className="font-mono-plex" style={{ fontSize: 12, lineHeight: 1.6, whiteSpace: "pre-wrap", borderRadius: 10, padding: 12, background: "rgba(255,92,92,0.05)", border: "1px solid rgba(255,92,92,0.12)", color: "rgba(255,200,200,0.7)", overflow: "auto", margin: 0 }}>
                      <code>{finding.patch_before}</code>
                    </pre>
                  </div>
                )}
                <div>
                  <div className="font-display" style={{ fontSize: 9.5, color: "#5cffb1", marginBottom: 6, textTransform: "uppercase" as const, letterSpacing: "0.08em" }}>After</div>
                  <pre className="font-mono-plex" style={{ fontSize: 12, lineHeight: 1.6, whiteSpace: "pre-wrap", borderRadius: 10, padding: 12, background: "rgba(92,255,177,0.05)", border: "1px solid rgba(92,255,177,0.12)", color: "rgba(180,255,220,0.7)", overflow: "auto", margin: 0 }}>
                    <code>{finding.patch_after}</code>
                  </pre>
                </div>
              </div>
              <button type="button" onClick={() => void navigator.clipboard.writeText(finding.patch_after!)}
                className="font-display" style={{ fontSize: 11, color: "#b8b4ff", marginTop: 10, background: "transparent", border: "none", cursor: "pointer", padding: 0 }}>
                Copy fix →
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Findings list ─────────────────────────────────────────────────────────────

function FindingsList({ findings }: { findings: Finding[] }) {
  const [filter, setFilter] = useState<Severity | "all">("all");

  const bySev: Record<Severity, Finding[]> = { critical: [], high: [], medium: [], low: [] };
  for (const f of findings) bySev[f.severity].push(f);

  const shown = filter === "all" ? findings : bySev[filter];
  let i = 0;

  return (
    <div>
      <div style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
        {(["all", "critical", "high", "medium", "low"] as const).map(s => {
          const cnt = s === "all" ? findings.length : bySev[s].length;
          if (s !== "all" && cnt === 0) return null;
          const active = filter === s;
          const col = s === "all" ? "#b8b4ff" : SEV[s];
          return (
            <button key={s} type="button" onClick={() => setFilter(s)}
              className="font-display"
              style={{
                fontSize: 12, padding: "5px 14px", borderRadius: 99, cursor: "pointer",
                border: `1px solid ${active ? col + "55" : "rgba(255,255,255,0.07)"}`,
                background: active ? col + "14" : "transparent",
                color: active ? col : "rgba(255,255,255,0.3)",
                transition: "all 0.12s",
              }}>
              {s === "all" ? "All" : s[0].toUpperCase() + s.slice(1)}
              {" "}<span style={{ opacity: 0.5 }}>{cnt}</span>
            </button>
          );
        })}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {shown.map(f => {
          const card = <FindingRow key={`${f.rule_id}-${i}`} finding={f} idx={i} />;
          i++;
          return card;
        })}
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AuditPage() {
  const params  = useParams<{ id: string }>();
  const auditId = params.id;

  const [job,      setJob]      = useState<JobStatus | null>(null);
  const [report,   setReport]   = useState<FullReport | null>(null);
  const [fetchErr, setFetchErr] = useState<string | null>(null);

  const pollJob = useCallback(async () => {
    try {
      const res = await fetch(`/api/audit?id=${auditId}`);
      if (!res.ok) { setFetchErr(`HTTP ${res.status}`); return; }
      const data = await res.json() as JobStatus;
      setJob(data);
      if (data.status === "done") {
        const rRes = await fetch(`/api/report/${auditId}`);
        if (rRes.ok) setReport(await rRes.json() as FullReport);
      }
    } catch (e) {
      console.warn("[audit page] poll error:", e);
    }
  }, [auditId]);

  useEffect(() => {
    void pollJob();
    const iv = setInterval(() => {
      setJob(j => { if (!j || !TERMINAL.includes(j.status)) void pollJob(); return j; });
    }, 2500);
    return () => clearInterval(iv);
  }, [pollJob]);

  const isDone   = job?.status === "done";
  const isFailed = job?.status === "failed";
  const isLive   = job && !isDone && !isFailed;

  const grade      = report?.risk_grade ?? "F";
  const gradeColor = GRADE_COLOR[grade] ?? "#f5f5f7";
  const { critical = 0, high = 0, medium = 0, low = 0 } = report?.severity_counts ?? {};
  const total = critical + high + medium + low;

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", background: "#000", color: "#f5f5f7", position: "relative" }}>

      {/* ── Aurora — fixed, always behind everything ──────────────────────── */}
      <div style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0, overflow: "hidden" }}>
        <AuroraBackground />
      </div>

      {/* ── Nav ─────────────────────────────────────────────────────────────── */}
      <nav style={{
        position: "sticky", top: 0, zIndex: 30,
        borderBottom: "1px solid rgba(184,180,255,0.07)",
        padding: "0 28px", height: 52,
        display: "flex", alignItems: "center", gap: 8,
        background: "rgba(0,0,0,0.88)",
        backdropFilter: "blur(24px)",
        WebkitBackdropFilter: "blur(24px)",
      }}>
        <Link href="/" style={{ display: "flex", alignItems: "center", gap: 7, textDecoration: "none" }}>
          <img src="/Logo.png" alt="MoveLens" style={{ height: 22 }} />
          <span className="font-display" style={{ fontSize: 14, fontWeight: 700, color: "#f5f5f7" }}>MoveLens</span>
        </Link>
        <span style={{ color: "rgba(255,255,255,0.1)", fontSize: 12 }}>/</span>
        <span className="font-display" style={{ fontSize: 12, color: "rgba(255,255,255,0.28)" }}>Audit</span>
        <span style={{ color: "rgba(255,255,255,0.1)", fontSize: 12 }}>/</span>
        <span className="font-mono-plex" style={{ fontSize: 11, color: "rgba(255,255,255,0.22)", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {auditId}
        </span>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
          {isLive && (
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <Spinner size={12} />
              <span className="font-display" style={{ fontSize: 12, color: "#b8b4ff" }}>
                {STAGE_LABEL[job.status]}
              </span>
            </span>
          )}
          {isDone   && <span className="font-display" style={{ fontSize: 11, padding: "3px 11px", borderRadius: 99, background: "rgba(92,255,177,0.08)",  color: "#5cffb1",  border: "1px solid rgba(92,255,177,0.2)"  }}>Complete</span>}
          {isFailed && <span className="font-display" style={{ fontSize: 11, padding: "3px 11px", borderRadius: 99, background: "rgba(255,92,92,0.08)",   color: "#ff5c5c",  border: "1px solid rgba(255,92,92,0.2)"  }}>Failed</span>}
        </div>
      </nav>

      {/* ── Error ───────────────────────────────────────────────────────────── */}
      {fetchErr && (
        <div style={{ position: "relative", zIndex: 10, maxWidth: 1440, margin: "20px auto", width: "100%", padding: "0 28px" }}>
          <div className="font-sans-switzer" style={{ padding: "14px 18px", borderRadius: 12, background: "rgba(255,92,92,0.06)", border: "1px solid rgba(255,92,92,0.2)", color: "#ff5c5c", fontSize: 14 }}>
            Failed to load: {fetchErr}
          </div>
        </div>
      )}

      {/* ── Initial spinner ─────────────────────────────────────────────────── */}
      {!job && !fetchErr && (
        <div style={{ position: "relative", zIndex: 10, flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 14, padding: "80px 28px", flexDirection: "column" }}>
          <Spinner size={20} />
          <span className="font-display" style={{ fontSize: 15, color: "rgba(255,255,255,0.28)" }}>Loading audit…</span>
        </div>
      )}

      {/* ── Pipeline running: full-page loading screen ───────────────────────── */}
      {isLive && (
        <div style={{
          position: "relative", zIndex: 10,
          flex: 1, display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center",
          padding: "80px 28px", textAlign: "center",
          minHeight: "calc(100vh - 52px)",
        }}>
          {/* Status pill */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 32 }}>
            <div style={{
              width: 9, height: 9, borderRadius: "50%",
              background: "#b8b4ff",
              boxShadow: "0 0 14px rgba(184,180,255,0.85)",
              animation: "mlPulse 1.5s ease-in-out infinite",
            }} />
            <span className="font-display" style={{ fontSize: 13, color: "rgba(184,180,255,0.55)", letterSpacing: "0.14em", textTransform: "uppercase" as const }}>
              In Progress
            </span>
          </div>

          {/* Big stage text */}
          <h1
            className="font-display"
            style={{
              fontSize: "clamp(52px, 9vw, 96px)",
              fontWeight: 800,
              letterSpacing: "-0.04em",
              color: "#f5f5f7",
              lineHeight: 0.92,
              marginBottom: 22,
            }}
          >
            {STAGE_LABEL[job.status]}
          </h1>

          {/* Subtitle */}
          <p className="font-sans-switzer" style={{
            fontSize: "clamp(14px, 2vw, 18px)",
            color: "rgba(255,255,255,0.3)",
            maxWidth: 500,
            lineHeight: 1.65,
            marginBottom: 56,
          }}>
            {STAGE_SUB[job.status]}
          </p>

          {/* Marquee line */}
          <div style={{ width: "min(300px, 80vw)", height: 2, borderRadius: 99, background: "rgba(255,255,255,0.07)", overflow: "hidden" }}>
            <div style={{
              height: "100%", width: "45%",
              background: "linear-gradient(90deg, transparent, #b8b4ff, transparent)",
              animation: "mlMarquee 2s linear infinite",
              borderRadius: 99,
            }} />
          </div>

          {/* Package ID */}
          <div className="font-mono-plex" style={{ marginTop: 36, fontSize: 11, color: "rgba(255,255,255,0.14)", wordBreak: "break-all", maxWidth: 500 }}>
            {auditId}
          </div>
        </div>
      )}

      {/* ── Failed ──────────────────────────────────────────────────────────── */}
      {isFailed && (
        <div style={{
          position: "relative", zIndex: 10, flex: 1,
          display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center",
          padding: "80px 28px", textAlign: "center",
        }}>
          <h1 className="font-display" style={{ fontSize: "clamp(52px, 9vw, 88px)", fontWeight: 800, letterSpacing: "-0.04em", color: "#ff5c5c", lineHeight: 0.92, marginBottom: 18 }}>
            Failed
          </h1>
          {job?.error && (
            <p className="font-sans-switzer" style={{ fontSize: 16, color: "rgba(255,255,255,0.32)", maxWidth: 420, lineHeight: 1.65 }}>{job.error}</p>
          )}
          <Link href="/app" className="font-display" style={{ fontSize: 13, color: "#b8b4ff", textDecoration: "none", marginTop: 36, opacity: 0.65 }}>
            ← Try again
          </Link>
        </div>
      )}

      {/* ── Done: full dashboard ─────────────────────────────────────────────── */}
      {isDone && report && (
        <div style={{ position: "relative", zIndex: 10, flex: 1 }}>

          {/* Hero */}
          <div style={{ maxWidth: 1440, margin: "0 auto", padding: "42px 28px 26px" }}>
            <div className="font-display" style={{ fontSize: 11, color: "rgba(255,193,92,0.42)", marginBottom: 18, display: "flex", alignItems: "center", gap: 7 }}>
              <span style={{ width: 5, height: 5, borderRadius: "50%", background: "rgba(255,193,92,0.5)", display: "inline-block" }} />
              Automated pre-screen — not a substitute for a human audit.
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 20, flexWrap: "wrap" }}>
              <div>
                <h1 className="font-display" style={{ fontSize: "clamp(38px, 5vw, 60px)", fontWeight: 800, letterSpacing: "-0.035em", color: "#f5f5f7", lineHeight: 1, marginBottom: 10 }}>
                  Security Report
                </h1>
                {report.package.mvrName && (
                  <div className="font-display" style={{ fontSize: 22, fontWeight: 600, color: "#b8b4ff", marginBottom: 7 }}>
                    {report.package.mvrName}
                  </div>
                )}
                <div className="font-mono-plex" style={{ fontSize: 11.5, color: "rgba(255,255,255,0.22)", wordBreak: "break-all", maxWidth: 580, marginBottom: 14 }}>
                  {report.package.packageId}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  {[
                    `${report.package.moduleCount} module${report.package.moduleCount !== 1 ? "s" : ""}`,
                    `v${report.package.version}`,
                    new Date(report.generated_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
                  ].map((t, i, arr) => (
                    <span key={t} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span className="font-display" style={{ fontSize: 14, color: "rgba(255,255,255,0.3)" }}>{t}</span>
                      {i < arr.length - 1 && <span style={{ color: "rgba(255,255,255,0.1)" }}>·</span>}
                    </span>
                  ))}
                  <span className="font-display" style={{ fontSize: 12, padding: "3px 11px", borderRadius: 99, background: report.package.network === "mainnet" ? "rgba(184,180,255,0.08)" : "rgba(77,162,255,0.08)", color: report.package.network === "mainnet" ? "#b8b4ff" : "#4da2ff", border: `1px solid ${report.package.network === "mainnet" ? "rgba(184,180,255,0.18)" : "rgba(77,162,255,0.18)"}` }}>
                    {report.package.network}
                  </span>
                </div>
              </div>

              {/* Grade letter */}
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, flexShrink: 0, paddingBottom: 6 }}>
                <div style={{ position: "relative" }}>
                  <div style={{ position: "absolute", inset: -30, background: `radial-gradient(circle, ${gradeColor}22 0%, transparent 70%)`, borderRadius: "50%", filter: "blur(22px)" }} />
                  <div className="font-display" style={{ fontSize: "clamp(80px, 10vw, 120px)", fontWeight: 900, letterSpacing: "-0.04em", color: gradeColor, lineHeight: 0.88, position: "relative" }}>
                    {grade}
                  </div>
                </div>
                <div className="font-display" style={{ fontSize: 13, color: "rgba(255,255,255,0.28)", letterSpacing: "0.04em" }}>
                  {GRADE_LABEL[grade]}
                </div>
              </div>
            </div>
          </div>

          {/* Degraded banner */}
          {job.degraded && (
            <div style={{ maxWidth: 1440, margin: "0 auto", padding: "0 28px 14px" }}>
              <div style={{ padding: "14px 18px", borderRadius: 14, background: "rgba(255,193,92,0.04)", border: "1px solid rgba(255,193,92,0.14)" }}>
                <div className="font-display" style={{ fontSize: 14, fontWeight: 600, color: "#ffc15c", marginBottom: 4 }}>⚠ Cached reference audit shown</div>
                <p className="font-sans-switzer" style={{ fontSize: 13, color: "rgba(255,193,92,0.42)", lineHeight: 1.55 }}>
                  Live Walrus upload was unavailable. Findings are real; only the on-chain storage step used a fallback.
                </p>
              </div>
            </div>
          )}

          {/* Two-column grid */}
          <div style={{ maxWidth: 1440, margin: "0 auto", padding: "0 28px 56px" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 300px", gap: 16, alignItems: "start" }}>

              {/* ── LEFT ── */}
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

                {/* Charts row */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>

                  {/* Severity bars */}
                  <div style={{ ...FORM_GLASS, borderRadius: 24, padding: "24px 26px", position: "relative", overflow: "hidden" }}>
                    <div style={{ position: "absolute", inset: "0 0 auto", height: 1, background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.12) 50%, transparent)" }} />
                    <div className="font-display" style={{ fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.28)", marginBottom: 20 }}>
                      Severity Distribution
                    </div>
                    <SeverityBars counts={report.severity_counts} />
                    <div style={{ borderTop: "1px solid rgba(184,180,255,0.07)", marginTop: 22, paddingTop: 16, display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {[
                        { label: "L1 · 65 rules", c: "#b8b4ff", bg: "rgba(184,180,255,0.07)" },
                        { label: "L2 · OZ",        c: "#4da2ff", bg: "rgba(77,162,255,0.07)"  },
                        ...(report.memory_context_used ? [{ label: `L3 · ${report.layer3_hits ?? 0} hits`, c: "#5cffb1", bg: "rgba(92,255,177,0.07)" }] : []),
                        ...(report.layer4_used ? [{ label: "L4 · ML", c: "#ff8b5c", bg: "rgba(255,140,92,0.07)" }] : []),
                      ].map(({ label, c, bg }) => (
                        <span key={label} className="font-display" style={{ fontSize: 10.5, padding: "3px 10px", borderRadius: 99, background: bg, color: c, border: `1px solid ${c}30` }}>
                          {label}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Category chart */}
                  <div style={{ ...FORM_GLASS, borderRadius: 24, padding: "24px 26px", position: "relative", overflow: "hidden" }}>
                    <div style={{ position: "absolute", inset: "0 0 auto", height: 1, background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.12) 50%, transparent)" }} />
                    <div className="font-display" style={{ fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.28)", marginBottom: 20 }}>
                      By Category
                    </div>
                    <CategoryChart findings={report.findings} />
                  </div>
                </div>

                {/* Findings */}
                <div style={{ ...GALLERY_CARD, borderRadius: 24, padding: "24px 26px" }}>
                  {report.findings.length > 0 ? (
                    <>
                      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 18 }}>
                        <h2 className="font-display" style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em", color: "#f5f5f7" }}>Findings</h2>
                        <span className="font-display" style={{ fontSize: 14, color: "rgba(255,255,255,0.25)" }}>{report.findings.length} total</span>
                      </div>
                      <FindingsList findings={report.findings} />
                    </>
                  ) : (
                    <div style={{ textAlign: "center", padding: "44px 20px" }}>
                      <div className="font-display" style={{ fontSize: 88, fontWeight: 900, letterSpacing: "-0.04em", color: "#5cffb1", lineHeight: 0.88, marginBottom: 16 }}>A</div>
                      <div className="font-display" style={{ fontSize: 20, fontWeight: 600, color: "#5cffb1", marginBottom: 8 }}>Clean contract</div>
                      <p className="font-sans-switzer" style={{ fontSize: 15, color: "rgba(255,255,255,0.28)" }}>No findings across all analysis layers.</p>
                    </div>
                  )}
                </div>

                <div style={{ textAlign: "center", paddingTop: 4 }}>
                  <Link href="/app" className="font-display" style={{ fontSize: 13, color: "#b8b4ff", textDecoration: "none", opacity: 0.55 }}>← Run another audit</Link>
                </div>
              </div>

              {/* ── RIGHT SIDEBAR ── */}
              <div style={{ display: "flex", flexDirection: "column", gap: 12, position: "sticky", top: 64 }}>

                {/* Severity 2×2 grid card — gallery style */}
                <div style={{ ...GALLERY_CARD, borderRadius: 20, overflow: "hidden" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr" }}>
                    {([
                      { sev: "critical" as Severity, count: critical },
                      { sev: "high"     as Severity, count: high },
                      { sev: "medium"   as Severity, count: medium },
                      { sev: "low"      as Severity, count: low },
                    ]).map(({ sev, count }, i) => (
                      <div key={sev} style={{
                        padding: "18px 20px",
                        borderRight: i % 2 === 0 ? CARD_DIVIDER : "none",
                        borderBottom: i < 2 ? CARD_DIVIDER : "none",
                        borderTop: `2px solid ${count > 0 ? SEV[sev] : "rgba(255,255,255,0.06)"}`,
                      }}>
                        <div className="font-display" style={{ fontSize: 36, fontWeight: 800, letterSpacing: "-0.04em", color: count > 0 ? SEV[sev] : "rgba(255,255,255,0.1)", lineHeight: 1, marginBottom: 5 }}>
                          {count}
                        </div>
                        <div className="font-display" style={{ fontSize: 9, color: count > 0 ? SEV[sev] + "99" : "rgba(255,255,255,0.2)", textTransform: "uppercase" as const, letterSpacing: "0.12em" }}>
                          {sev}
                        </div>
                      </div>
                    ))}
                  </div>
                  {/* Severity stripe */}
                  <div style={{ height: 3, display: "flex" }}>
                    {critical > 0 && <div style={{ flex: critical, background: SEV.critical }} />}
                    {high     > 0 && <div style={{ flex: high,     background: SEV.high }} />}
                    {medium   > 0 && <div style={{ flex: medium,   background: SEV.medium }} />}
                    {low      > 0 && <div style={{ flex: low,      background: SEV.low }} />}
                    {total === 0  && <div style={{ flex: 1,        background: "#5cffb1" }} />}
                  </div>
                  <div style={{ padding: "14px 20px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span className="font-display" style={{ fontSize: 12, color: "rgba(255,255,255,0.2)" }}>{total} total findings</span>
                    <span className="font-display" style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-0.04em", color: gradeColor }}>{grade}</span>
                  </div>
                </div>

                {/* Provenance */}
                <div style={{ ...FORM_GLASS, borderRadius: 20, padding: "18px 20px" }}>
                  <div className="font-display" style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.28)", marginBottom: 16 }}>Provenance</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                    {job.blobId ? (
                      <div>
                        <div className="font-display" style={{ fontSize: 9.5, color: "rgba(184,180,255,0.38)", textTransform: "uppercase" as const, letterSpacing: "0.14em", marginBottom: 6 }}>Walrus Blob</div>
                        <a href={`https://aggregator.walrus-testnet.walrus.space/v1/blobs/${job.blobId}`} target="_blank" rel="noopener noreferrer" className="font-mono-plex" style={{ fontSize: 10, color: "#4da2ff", wordBreak: "break-all", lineHeight: 1.5, display: "block" }}>
                          {job.blobId}
                        </a>
                        <div className="font-display" style={{ fontSize: 10, color: "rgba(255,255,255,0.18)", marginTop: 4 }}>AES-256 · 5 epochs</div>
                      </div>
                    ) : (
                      <div>
                        <div className="font-display" style={{ fontSize: 9.5, color: "rgba(184,180,255,0.38)", textTransform: "uppercase" as const, letterSpacing: "0.14em", marginBottom: 4 }}>Walrus Blob</div>
                        <div className="font-display" style={{ fontSize: 12, color: "rgba(255,255,255,0.18)" }}>Not uploaded</div>
                      </div>
                    )}
                    {job.txDigest && (
                      <div>
                        <div className="font-display" style={{ fontSize: 9.5, color: "rgba(184,180,255,0.38)", textTransform: "uppercase" as const, letterSpacing: "0.14em", marginBottom: 6 }}>MVR Tx</div>
                        <a href={`https://suiscan.xyz/testnet/tx/${job.txDigest}`} target="_blank" rel="noopener noreferrer" className="font-mono-plex" style={{ fontSize: 10, color: "#4da2ff", wordBreak: "break-all" }}>
                          {job.txDigest}
                        </a>
                      </div>
                    )}
                    <div>
                      <div className="font-display" style={{ fontSize: 9.5, color: "rgba(184,180,255,0.38)", textTransform: "uppercase" as const, letterSpacing: "0.14em", marginBottom: 6 }}>Seal</div>
                      <span className="font-display" style={{ fontSize: 11, padding: "3px 9px", borderRadius: 99, background: report.sealed ? "rgba(92,255,177,0.07)" : "rgba(255,255,255,0.04)", color: report.sealed ? "#5cffb1" : "rgba(255,255,255,0.22)", border: `1px solid ${report.sealed ? "rgba(92,255,177,0.18)" : "rgba(255,255,255,0.06)"}` }}>
                        {report.sealed ? "IBE encrypted" : "Plaintext fallback"}
                      </span>
                    </div>
                    <div>
                      <div className="font-display" style={{ fontSize: 9.5, color: "rgba(184,180,255,0.38)", textTransform: "uppercase" as const, letterSpacing: "0.14em", marginBottom: 5 }}>Generated</div>
                      <div className="font-sans-switzer" style={{ fontSize: 12, color: "rgba(255,255,255,0.35)" }}>
                        {new Date(report.generated_at).toLocaleString()}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Watermark */}
                <div style={{ padding: "12px 14px", borderRadius: 12, background: "rgba(255,193,92,0.03)", border: "1px solid rgba(255,193,92,0.07)", textAlign: "center" }}>
                  <p className="font-display" style={{ fontSize: 9.5, color: "rgba(255,193,92,0.35)", lineHeight: 1.6 }}>
                    Automated pre-screen — not a substitute for a human audit.
                  </p>
                </div>

              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Footer ──────────────────────────────────────────────────────────── */}
      <footer style={{ position: "relative", zIndex: 10, borderTop: "1px solid rgba(184,180,255,0.06)", padding: "12px 28px", textAlign: "center" }}>
        <span className="font-display" style={{ fontSize: 11, color: "rgba(255,255,255,0.14)" }}>
          Automated pre-screen — not a substitute for a human audit. · Sui Overflow 2026 · Walrus Track
        </span>
      </footer>
    </div>
  );
}
