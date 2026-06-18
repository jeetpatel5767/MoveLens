"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
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

// ── Tokens ────────────────────────────────────────────────────────────────────

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

const DIVIDER = "1px solid rgba(184,180,255,0.07)";

const CARD: React.CSSProperties = {
  borderRadius: 16,
  background: "rgba(8,6,20,0.65)",
  border: DIVIDER,
};

const SOURCE: Record<FindingSource, { label: string; color: string; bg: string }> = {
  layer1: { label: "L1 · Rule",   color: "#b8b4ff", bg: "rgba(184,180,255,0.09)" },
  layer2: { label: "L2 · OZ",     color: "#4da2ff", bg: "rgba(77,162,255,0.09)"  },
  layer3: { label: "L3 · Memory", color: "#5cffb1", bg: "rgba(92,255,177,0.09)" },
  layer4: { label: "L4 · ML",     color: "#ff8b5c", bg: "rgba(255,140,92,0.09)" },
};

const STAGES: { key: AuditStatus; label: string; sub: string }[] = [
  { key: "fetching",   label: "Fetch Package",    sub: "Sui GraphQL · modules" },
  { key: "auditing",   label: "4-Layer Analysis", sub: "65 rules · OZ · LanceDB · Groq" },
  { key: "encrypting", label: "Seal Encryption",  sub: "IBE threshold" },
  { key: "uploading",  label: "Walrus Upload",    sub: "5-epoch storage" },
  { key: "linking",    label: "MVR Link",         sub: "On-chain registration" },
  { key: "done",       label: "Complete",         sub: "Report ready" },
];

const TERMINAL: AuditStatus[] = ["done", "failed"];

// ── Micro ─────────────────────────────────────────────────────────────────────

function Spinner({ size = 16, color = "#b8b4ff" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      style={{ animation: "mlSpin 0.9s linear infinite", flexShrink: 0 }}>
      <circle cx="12" cy="12" r="10" stroke={color} strokeWidth="2.5" strokeOpacity="0.2" />
      <path fill={color} d="M4 12a8 8 0 018-8v8H4z" />
    </svg>
  );
}

function Check() {
  return (
    <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
      <path d="M1.5 5.5l2.5 2.5L9.5 2" stroke="#5cffb1" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ── Donut chart ───────────────────────────────────────────────────────────────

function DonutChart({ counts }: { counts: SeverityCounts }) {
  const total = counts.critical + counts.high + counts.medium + counts.low;
  const r = 68, cx = 84, cy = 84, sw = 15;
  const circ = 2 * Math.PI * r;

  const segs = [
    { key: "critical", count: counts.critical, color: SEV.critical },
    { key: "high",     count: counts.high,     color: SEV.high },
    { key: "medium",   count: counts.medium,   color: SEV.medium },
    { key: "low",      count: counts.low,      color: SEV.low },
  ].filter(s => s.count > 0);

  let cum = 0;

  return (
    <svg viewBox="0 0 168 168" width={168} height={168} aria-hidden>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth={sw} />
      {total === 0
        ? <circle cx={cx} cy={cy} r={r} fill="none" stroke="#5cffb1" strokeWidth={sw} opacity={0.25} />
        : segs.map(seg => {
            const pct = seg.count / total;
            const arc = pct * circ;
            const off = -(cum * circ);
            cum += pct;
            return (
              <circle key={seg.key} cx={cx} cy={cy} r={r} fill="none"
                stroke={seg.color} strokeWidth={sw}
                strokeDasharray={`${arc} ${circ}`}
                strokeDashoffset={off}
                transform={`rotate(-90 ${cx} ${cy})`}
                opacity={0.88}
              />
            );
          })}
      <text x={cx} y={cy - 7} textAnchor="middle" fill="#f5f5f7"
        fontSize="26" fontWeight="800" fontFamily="Cabinet Grotesk, sans-serif" letterSpacing="-1">
        {total}
      </text>
      <text x={cx} y={cy + 13} textAnchor="middle" fill="rgba(255,255,255,0.25)"
        fontSize="9.5" fontFamily="Cabinet Grotesk, sans-serif" letterSpacing="0.06em">
        FINDINGS
      </text>
    </svg>
  );
}

// ── Category bars ─────────────────────────────────────────────────────────────

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
    <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
      {cats.map(([cat, { count, topSev }]) => (
        <div key={cat}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
            <span className="font-mono-plex" style={{ fontSize: 9.5, color: "rgba(255,255,255,0.38)", letterSpacing: "0.06em" }}>
              {cat.toUpperCase()}
            </span>
            <span className="font-display" style={{ fontSize: 11, fontWeight: 700, color: SEV[topSev] }}>{count}</span>
          </div>
          <div style={{ height: 3, borderRadius: 99, overflow: "hidden", background: "rgba(255,255,255,0.05)" }}>
            <div style={{
              height: "100%", borderRadius: 99,
              width: `${(count / max) * 100}%`,
              background: SEV[topSev],
              opacity: 0.65,
              transition: "width 0.8s cubic-bezier(0.4,0,0.2,1)",
            }} />
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Pipeline ──────────────────────────────────────────────────────────────────

function Pipeline({ job }: { job: JobStatus }) {
  const failed = job.status === "failed";
  const done   = job.status === "done";

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {STAGES.map((stage, i) => {
        const visited  = job.stagesVisited?.includes(stage.key) ?? false;
        const active   = job.status === stage.key && !failed;
        const failHere = failed && job.status === stage.key;
        const complete = (visited && !active && !failHere) || (stage.key === "done" && done);
        const pending  = !visited && !active && !failHere;
        const last     = i === STAGES.length - 1;

        const dotBg     = complete ? "rgba(92,255,177,0.12)"  : active ? "rgba(184,180,255,0.12)" : failHere ? "rgba(255,92,92,0.1)" : "rgba(255,255,255,0.03)";
        const dotBorder = complete ? "rgba(92,255,177,0.3)"   : active ? "rgba(184,180,255,0.4)"  : failHere ? "rgba(255,92,92,0.3)" : "rgba(255,255,255,0.08)";
        const textColor = active   ? "#f5f5f7" : complete ? "rgba(255,255,255,0.6)" : failHere ? "#ff5c5c" : "rgba(255,255,255,0.22)";

        return (
          <div key={stage.key} style={{ display: "flex", gap: 10, opacity: pending ? 0.28 : 1 }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 18, flexShrink: 0 }}>
              <div style={{ width: 18, height: 18, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", background: dotBg, border: `1px solid ${dotBorder}`, flexShrink: 0 }}>
                {active    ? <Spinner size={9} /> :
                 complete  ? <Check /> :
                 failHere  ? <span style={{ fontSize: 8, color: "#ff5c5c" }}>✕</span> :
                             <span className="font-mono-plex" style={{ fontSize: 7.5, color: "rgba(255,255,255,0.2)" }}>{i + 1}</span>}
              </div>
              {!last && <div style={{ width: 1, flex: 1, minHeight: 10, marginTop: 3, background: complete ? "rgba(92,255,177,0.18)" : "rgba(255,255,255,0.05)" }} />}
            </div>
            <div style={{ paddingBottom: last ? 0 : 12, paddingTop: 1 }}>
              <div className="font-display" style={{ fontSize: 12, fontWeight: 500, color: textColor }}>{stage.label}</div>
              {(active || complete) && (
                <div className="font-display" style={{ fontSize: 10, color: "rgba(255,255,255,0.22)", marginTop: 1 }}>{stage.sub}</div>
              )}
            </div>
          </div>
        );
      })}
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
      border: open ? `1px solid ${c}28` : DIVIDER,
      borderRadius: 13,
      overflow: "hidden",
      background: open ? `${c}07` : "rgba(6,4,16,0.5)",
      transition: "border-color 0.15s, background 0.15s",
    }}>
      <button type="button" onClick={() => setOpen(v => !v)}
        style={{ width: "100%", textAlign: "left", display: "flex", alignItems: "center", gap: 10, padding: "11px 14px", cursor: "pointer", background: "transparent", border: "none" }}>

        <div style={{ width: 7, height: 7, borderRadius: "50%", background: c, flexShrink: 0, boxShadow: `0 0 6px ${c}70` }} />

        <span className="font-mono-plex" style={{ fontSize: 9, color: "rgba(255,255,255,0.22)", width: 16, flexShrink: 0, textAlign: "right" }}>
          {String(idx + 1).padStart(2, "0")}
        </span>

        <span className="font-mono-plex" style={{ fontSize: 10, padding: "2px 6px", borderRadius: 5, background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.45)", flexShrink: 0, whiteSpace: "nowrap" }}>
          {finding.rule_id}
        </span>

        <span className="font-sans-switzer" style={{ fontSize: 12, color: "rgba(255,255,255,0.65)", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {finding.description}
        </span>

        <span className="font-display" style={{ fontSize: 9, padding: "2px 7px", borderRadius: 99, background: src.bg, color: src.color, flexShrink: 0, whiteSpace: "nowrap" }}>
          {src.label}
        </span>

        <span className="font-mono-plex" style={{ fontSize: 9, color: "rgba(255,255,255,0.2)", flexShrink: 0 }}>:{finding.line_start}</span>

        <span style={{ fontSize: 9, color: "rgba(184,180,255,0.3)", transform: open ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.18s ease", flexShrink: 0 }}>▼</span>
      </button>

      {open && (
        <div style={{ borderTop: DIVIDER, padding: "16px 16px 18px", display: "flex", flexDirection: "column", gap: 14 }}>
          {/* Location + confidence */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span className="font-mono-plex" style={{ fontSize: 10, padding: "3px 8px", borderRadius: 7, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.45)" }}>
              {finding.module}:{finding.line_start}{finding.line_end !== finding.line_start ? `–${finding.line_end}` : ""}
            </span>
            <div style={{ display: "flex", alignItems: "center", gap: 6, flex: 1, minWidth: 100 }}>
              <span className="font-display" style={{ fontSize: 9, color: "rgba(255,255,255,0.25)", whiteSpace: "nowrap" }}>confidence</span>
              <div style={{ flex: 1, height: 2, borderRadius: 99, background: "rgba(255,255,255,0.07)", overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${pct}%`, background: c, opacity: 0.55, transition: "width 0.4s ease", borderRadius: 99 }} />
              </div>
              <span className="font-mono-plex" style={{ fontSize: 9, color: "rgba(255,255,255,0.28)", flexShrink: 0 }}>{pct}%</span>
            </div>
          </div>

          <div>
            <div className="font-display" style={{ fontSize: 9.5, color: "rgba(184,180,255,0.3)", textTransform: "uppercase" as const, letterSpacing: "0.1em", marginBottom: 5 }}>Description</div>
            <p className="font-sans-switzer" style={{ fontSize: 13, lineHeight: 1.65, color: "rgba(255,255,255,0.58)" }}>{finding.description}</p>
          </div>

          <div>
            <div className="font-display" style={{ fontSize: 9.5, color: "rgba(184,180,255,0.3)", textTransform: "uppercase" as const, letterSpacing: "0.1em", marginBottom: 5 }}>Recommendation</div>
            <p className="font-sans-switzer" style={{ fontSize: 13, lineHeight: 1.65, color: "rgba(255,255,255,0.58)" }}>{finding.recommendation}</p>
          </div>

          {finding.patch_after && (
            <div>
              <div className="font-display" style={{ fontSize: 9.5, color: "rgba(184,180,255,0.3)", textTransform: "uppercase" as const, letterSpacing: "0.1em", marginBottom: 8 }}>Suggested Fix</div>
              <div style={{ display: "grid", gridTemplateColumns: finding.patch_before ? "1fr 1fr" : "1fr", gap: 8 }}>
                {finding.patch_before && (
                  <div>
                    <div className="font-display" style={{ fontSize: 9, color: SEV.critical, marginBottom: 5, textTransform: "uppercase" as const, letterSpacing: "0.08em" }}>Before</div>
                    <pre className="font-mono-plex" style={{ fontSize: 11, lineHeight: 1.6, whiteSpace: "pre-wrap", borderRadius: 10, padding: 12, background: "rgba(255,92,92,0.05)", border: "1px solid rgba(255,92,92,0.12)", color: "rgba(255,200,200,0.7)", overflow: "auto", margin: 0 }}>
                      <code>{finding.patch_before}</code>
                    </pre>
                  </div>
                )}
                <div>
                  <div className="font-display" style={{ fontSize: 9, color: "#5cffb1", marginBottom: 5, textTransform: "uppercase" as const, letterSpacing: "0.08em" }}>After</div>
                  <pre className="font-mono-plex" style={{ fontSize: 11, lineHeight: 1.6, whiteSpace: "pre-wrap", borderRadius: 10, padding: 12, background: "rgba(92,255,177,0.05)", border: "1px solid rgba(92,255,177,0.12)", color: "rgba(180,255,220,0.7)", overflow: "auto", margin: 0 }}>
                    <code>{finding.patch_after}</code>
                  </pre>
                </div>
              </div>
              <button type="button" onClick={() => void navigator.clipboard.writeText(finding.patch_after!)}
                className="font-display" style={{ fontSize: 10, color: "#b8b4ff", marginTop: 8, background: "transparent", border: "none", cursor: "pointer", padding: 0 }}>
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
      {/* Filter strip */}
      <div style={{ display: "flex", gap: 5, marginBottom: 14, flexWrap: "wrap" }}>
        {(["all", "critical", "high", "medium", "low"] as const).map(s => {
          const cnt = s === "all" ? findings.length : bySev[s].length;
          if (s !== "all" && cnt === 0) return null;
          const active = filter === s;
          const col = s === "all" ? "#b8b4ff" : SEV[s];
          return (
            <button key={s} type="button" onClick={() => setFilter(s)}
              className="font-display"
              style={{
                fontSize: 11, padding: "4px 11px", borderRadius: 99, cursor: "pointer",
                border: `1px solid ${active ? col + "55" : "rgba(255,255,255,0.06)"}`,
                background: active ? col + "14" : "transparent",
                color: active ? col : "rgba(255,255,255,0.3)",
                transition: "all 0.12s",
              }}>
              {s === "all" ? "All" : s[0].toUpperCase() + s.slice(1)}
              {" "}<span style={{ opacity: 0.55 }}>{cnt}</span>
            </button>
          );
        })}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
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
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", background: "#000", color: "#f5f5f7" }}>

      {/* ── Nav ─────────────────────────────────────────────────────────────── */}
      <nav style={{
        borderBottom: "1px solid rgba(184,180,255,0.07)",
        padding: "0 28px", height: 50,
        display: "flex", alignItems: "center", gap: 8,
        position: "sticky", top: 0, zIndex: 30,
        background: "rgba(0,0,0,0.9)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
      }}>
        <Link href="/" style={{ display: "flex", alignItems: "center", gap: 7, textDecoration: "none" }}>
          <img src="/Logo.png" alt="MoveLens" style={{ height: 22 }} />
          <span className="font-display" style={{ fontSize: 13, fontWeight: 700, color: "#f5f5f7" }}>MoveLens</span>
        </Link>
        <span style={{ color: "rgba(255,255,255,0.1)", fontSize: 11 }}>/</span>
        <span className="font-display" style={{ fontSize: 11, color: "rgba(255,255,255,0.28)" }}>Audit</span>
        <span style={{ color: "rgba(255,255,255,0.1)", fontSize: 11 }}>/</span>
        <span className="font-mono-plex" style={{ fontSize: 10, color: "rgba(255,255,255,0.22)", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {auditId}
        </span>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
          {isLive && (
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <Spinner size={12} />
              <span className="font-display" style={{ fontSize: 11, color: "#b8b4ff" }}>Analyzing</span>
            </span>
          )}
          {isDone && <span className="font-display" style={{ fontSize: 10, padding: "3px 10px", borderRadius: 99, background: "rgba(92,255,177,0.08)", color: "#5cffb1", border: "1px solid rgba(92,255,177,0.2)" }}>Complete</span>}
          {isFailed && <span className="font-display" style={{ fontSize: 10, padding: "3px 10px", borderRadius: 99, background: "rgba(255,92,92,0.08)", color: "#ff5c5c", border: "1px solid rgba(255,92,92,0.2)" }}>Failed</span>}
        </div>
      </nav>

      {/* ── Hero ────────────────────────────────────────────────────────────── */}
      {job && (
        <div style={{ position: "relative", overflow: "hidden" }}>
          {/* Aurora glow */}
          <div aria-hidden style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
            <div style={{
              position: "absolute", top: "-60%", left: "50%", transform: "translateX(-50%)",
              width: "120%", height: "260%",
              background: isDone
                ? `radial-gradient(ellipse 65% 45% at 50% 0%, ${gradeColor}1a 0%, transparent 65%)`
                : "radial-gradient(ellipse 65% 45% at 50% 0%, rgba(184,180,255,0.13) 0%, transparent 65%)",
              animation: "mlAurora 18s ease-in-out infinite",
            }} />
          </div>

          <div style={{ maxWidth: 1440, margin: "0 auto", padding: "36px 28px 0", position: "relative" }}>
            {isDone && report ? (
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 20 }}>
                {/* Left: title + meta */}
                <div>
                  <div className="font-display" style={{ fontSize: 10, color: "rgba(255,193,92,0.5)", marginBottom: 14, display: "flex", alignItems: "center", gap: 5 }}>
                    <span style={{ width: 4, height: 4, borderRadius: "50%", background: "rgba(255,193,92,0.5)", display: "inline-block", flexShrink: 0 }} />
                    Automated pre-screen — not a substitute for a human audit.
                  </div>
                  <h1 className="font-display" style={{ fontSize: 38, fontWeight: 800, letterSpacing: "-0.03em", color: "#f5f5f7", lineHeight: 1, marginBottom: 8 }}>
                    Security Report
                  </h1>
                  {report.package.mvrName && (
                    <div className="font-display" style={{ fontSize: 17, fontWeight: 600, color: "#b8b4ff", marginBottom: 5 }}>
                      {report.package.mvrName}
                    </div>
                  )}
                  <div className="font-mono-plex" style={{ fontSize: 10.5, color: "rgba(255,255,255,0.22)", wordBreak: "break-all", maxWidth: 540, marginBottom: 12 }}>
                    {report.package.packageId}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    {[
                      `${report.package.moduleCount} module${report.package.moduleCount !== 1 ? "s" : ""}`,
                      `v${report.package.version}`,
                      new Date(report.generated_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
                    ].map((t, i, arr) => (
                      <span key={t} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span className="font-display" style={{ fontSize: 11, color: "rgba(255,255,255,0.28)" }}>{t}</span>
                        {i < arr.length - 1 && <span style={{ color: "rgba(255,255,255,0.1)" }}>·</span>}
                      </span>
                    ))}
                    <span className="font-display" style={{ fontSize: 10, padding: "2px 8px", borderRadius: 99, background: report.package.network === "mainnet" ? "rgba(184,180,255,0.08)" : "rgba(77,162,255,0.08)", color: report.package.network === "mainnet" ? "#b8b4ff" : "#4da2ff", border: `1px solid ${report.package.network === "mainnet" ? "rgba(184,180,255,0.18)" : "rgba(77,162,255,0.18)"}` }}>
                      {report.package.network}
                    </span>
                  </div>
                </div>

                {/* Right: grade */}
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 5, flexShrink: 0 }}>
                  <div style={{ position: "relative" }}>
                    <div style={{ position: "absolute", inset: -24, background: `radial-gradient(circle, ${gradeColor}28 0%, transparent 70%)`, borderRadius: "50%", filter: "blur(18px)" }} />
                    <div className="font-display" style={{ fontSize: 112, fontWeight: 900, letterSpacing: "-0.04em", color: gradeColor, lineHeight: 0.88, position: "relative" }}>
                      {grade}
                    </div>
                  </div>
                  <div className="font-display" style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", letterSpacing: "0.04em" }}>
                    {GRADE_LABEL[grade]}
                  </div>
                </div>
              </div>
            ) : isFailed ? (
              <div>
                <h1 className="font-display" style={{ fontSize: 34, fontWeight: 800, letterSpacing: "-0.03em", color: "#ff5c5c" }}>Audit Failed</h1>
                {job.error && <p className="font-sans-switzer" style={{ fontSize: 13, color: "rgba(255,255,255,0.4)", marginTop: 6 }}>{job.error}</p>}
              </div>
            ) : (
              <div>
                <h1 className="font-display" style={{ fontSize: 34, fontWeight: 800, letterSpacing: "-0.03em", color: "#f5f5f7", marginBottom: 6 }}>
                  Analyzing Contract
                </h1>
                <p className="font-mono-plex" style={{ fontSize: 10.5, color: "rgba(255,255,255,0.22)", wordBreak: "break-all" }}>{auditId}</p>
              </div>
            )}
          </div>

          {/* Severity stat cards */}
          {isDone && report && (
            <div style={{ maxWidth: 1440, margin: "0 auto", padding: "22px 28px 0" }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
                {([
                  { sev: "critical" as Severity, count: critical, label: "Critical" },
                  { sev: "high"     as Severity, count: high,     label: "High" },
                  { sev: "medium"   as Severity, count: medium,   label: "Medium" },
                  { sev: "low"      as Severity, count: low,      label: "Low" },
                ]).map(({ sev, count, label }) => (
                  <div key={sev} style={{
                    borderRadius: 14, padding: "16px 18px",
                    background: count > 0 ? `${SEV[sev]}0c` : "rgba(255,255,255,0.02)",
                    border: `1px solid ${count > 0 ? SEV[sev] + "28" : "rgba(255,255,255,0.04)"}`,
                  }}>
                    <div className="font-display" style={{ fontSize: 34, fontWeight: 800, letterSpacing: "-0.04em", color: count > 0 ? SEV[sev] : "rgba(255,255,255,0.12)", lineHeight: 1 }}>
                      {count}
                    </div>
                    <div className="font-display" style={{ fontSize: 10, color: count > 0 ? SEV[sev] + "aa" : "rgba(255,255,255,0.18)", textTransform: "uppercase" as const, letterSpacing: "0.1em", marginTop: 4 }}>
                      {label}
                    </div>
                    <div style={{ height: 2, borderRadius: 99, marginTop: 10, background: count > 0 ? SEV[sev] : "rgba(255,255,255,0.04)", opacity: count > 0 ? Math.min(1, 0.25 + (count / Math.max(total, 1))) : 0.3 }} />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Main grid ───────────────────────────────────────────────────────── */}
      <main style={{ flex: 1, maxWidth: 1440, margin: "0 auto", width: "100%", padding: "20px 28px 48px" }}>

        {fetchErr && (
          <div className="font-sans-switzer" style={{ padding: "14px 18px", borderRadius: 12, background: "rgba(255,92,92,0.06)", border: "1px solid rgba(255,92,92,0.2)", color: "#ff5c5c", fontSize: 13 }}>
            Failed to load: {fetchErr}
          </div>
        )}

        {!job && !fetchErr && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, padding: "80px 0" }}>
            <Spinner size={18} />
            <span className="font-display" style={{ fontSize: 14, color: "rgba(255,255,255,0.28)" }}>Loading audit…</span>
          </div>
        )}

        {job && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 300px", gap: 16, alignItems: "start" }}>

            {/* ── LEFT ── */}
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

              {/* Degraded banner */}
              {isDone && job.degraded && (
                <div style={{ padding: "13px 16px", borderRadius: 12, background: "rgba(255,193,92,0.04)", border: "1px solid rgba(255,193,92,0.16)" }}>
                  <div className="font-display" style={{ fontSize: 12, fontWeight: 600, color: "#ffc15c", marginBottom: 3 }}>⚠ Cached reference audit shown</div>
                  <p className="font-sans-switzer" style={{ fontSize: 11.5, color: "rgba(255,193,92,0.48)", lineHeight: 1.55 }}>
                    Live Walrus upload was unavailable. Findings are real; only the on-chain storage step used a fallback.
                  </p>
                </div>
              )}

              {/* Charts row */}
              {isDone && report && (
                <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 12 }}>
                  {/* Donut */}
                  <div style={{ ...CARD, padding: "18px 20px", display: "flex", flexDirection: "column", gap: 12 }}>
                    <div className="font-display" style={{ fontSize: 10.5, fontWeight: 600, color: "rgba(255,255,255,0.28)" }}>Distribution</div>
                    <div style={{ display: "flex", gap: 18, alignItems: "center" }}>
                      <DonutChart counts={report.severity_counts} />
                      <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
                        {(["critical", "high", "medium", "low"] as Severity[]).map(s => {
                          const cnt = report.severity_counts[s];
                          const pct = total > 0 ? Math.round((cnt / total) * 100) : 0;
                          return (
                            <div key={s} style={{ display: "flex", alignItems: "center", gap: 7 }}>
                              <div style={{ width: 7, height: 7, borderRadius: "50%", background: SEV[s], flexShrink: 0 }} />
                              <span className="font-display" style={{ fontSize: 10.5, color: "rgba(255,255,255,0.42)", width: 50 }}>
                                {s[0].toUpperCase() + s.slice(1)}
                              </span>
                              <span className="font-display" style={{ fontSize: 13, fontWeight: 700, color: cnt > 0 ? SEV[s] : "rgba(255,255,255,0.15)", width: 18 }}>{cnt}</span>
                              <span className="font-mono-plex" style={{ fontSize: 9.5, color: "rgba(255,255,255,0.18)" }}>{pct}%</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  {/* Categories */}
                  <div style={{ ...CARD, padding: "18px 20px" }}>
                    <div className="font-display" style={{ fontSize: 10.5, fontWeight: 600, color: "rgba(255,255,255,0.28)", marginBottom: 14 }}>By Category</div>
                    <CategoryChart findings={report.findings} />
                    {/* Engine badges */}
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 16, paddingTop: 12, borderTop: "1px solid rgba(184,180,255,0.06)" }}>
                      {[
                        { label: "L1 · 65 rules", c: "#b8b4ff", bg: "rgba(184,180,255,0.07)", b: "rgba(184,180,255,0.14)" },
                        { label: "L2 · OZ",        c: "#4da2ff", bg: "rgba(77,162,255,0.07)",  b: "rgba(77,162,255,0.14)"  },
                        ...(report.memory_context_used ? [{ label: `L3 · ${report.layer3_hits ?? 0} hits`, c: "#5cffb1", bg: "rgba(92,255,177,0.07)", b: "rgba(92,255,177,0.14)" }] : []),
                        ...(report.layer4_used ? [{ label: "L4 · ML", c: "#ff8b5c", bg: "rgba(255,140,92,0.07)", b: "rgba(255,140,92,0.14)" }] : []),
                      ].map(({ label, c, bg, b }) => (
                        <span key={label} className="font-display" style={{ fontSize: 9, padding: "3px 8px", borderRadius: 99, background: bg, color: c, border: `1px solid ${b}` }}>
                          {label}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Analyzing visual */}
              {isLive && (
                <div style={{ ...CARD, padding: "40px 28px", display: "flex", flexDirection: "column", alignItems: "center", gap: 22 }}>
                  <div style={{ position: "relative", width: 72, height: 72 }}>
                    <div style={{ width: 72, height: 72, borderRadius: "50%", border: "1.5px solid rgba(184,180,255,0.12)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <div style={{ width: 52, height: 52, borderRadius: "50%", border: "1.5px solid rgba(184,180,255,0.07)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <Spinner size={22} />
                      </div>
                    </div>
                    <div style={{ position: "absolute", top: "50%", left: -6, right: -6, height: 1, background: "linear-gradient(90deg, transparent, rgba(184,180,255,0.35), transparent)", animation: "mlScan 2.6s ease-in-out infinite", marginTop: -0.5 }} />
                  </div>
                  <div style={{ textAlign: "center" }}>
                    <div className="font-display" style={{ fontSize: 14, fontWeight: 600, color: "rgba(255,255,255,0.55)", marginBottom: 4 }}>Running 4-Layer Analysis</div>
                    <div className="font-sans-switzer" style={{ fontSize: 12, color: "rgba(255,255,255,0.25)" }}>65 rules · OZ benchmarks · LanceDB recall · Groq ML</div>
                  </div>
                  <div style={{ width: "100%", maxWidth: 340, display: "flex", flexDirection: "column", gap: 8 }}>
                    {[
                      { label: "L1 Deterministic", color: "#b8b4ff" },
                      { label: "L2 OZ Benchmark",  color: "#4da2ff" },
                      { label: "L3 Semantic",       color: "#5cffb1" },
                      { label: "L4 ML",             color: "#ff8b5c" },
                    ].map((l, idx) => (
                      <div key={l.label} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span className="font-mono-plex" style={{ fontSize: 9, color: "rgba(255,255,255,0.22)", width: 110, flexShrink: 0 }}>{l.label}</span>
                        <div style={{ flex: 1, height: 2, borderRadius: 99, background: "rgba(255,255,255,0.06)", overflow: "hidden" }}>
                          <div style={{ height: "100%", background: l.color, width: "55%", animation: `mlPulse 2.4s ease-in-out infinite ${idx * 0.18}s`, borderRadius: 99 }} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Failed */}
              {isFailed && job.error && (
                <div style={{ ...CARD, padding: "16px 18px", background: "rgba(255,92,92,0.04)", borderColor: "rgba(255,92,92,0.18)" }}>
                  <div className="font-display" style={{ fontSize: 13, fontWeight: 600, color: "#ff5c5c", marginBottom: 6 }}>Pipeline error</div>
                  <p className="font-sans-switzer" style={{ fontSize: 13, color: "rgba(255,160,160,0.65)", lineHeight: 1.6 }}>{job.error}</p>
                </div>
              )}

              {/* Findings */}
              {isDone && report && (
                <div style={{ ...CARD, padding: "18px 20px" }}>
                  {report.findings.length > 0 ? (
                    <>
                      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 14 }}>
                        <h2 className="font-display" style={{ fontSize: 17, fontWeight: 700, letterSpacing: "-0.02em", color: "#f5f5f7" }}>Findings</h2>
                        <span className="font-display" style={{ fontSize: 12, color: "rgba(255,255,255,0.25)" }}>{report.findings.length} total</span>
                      </div>
                      <FindingsList findings={report.findings} />
                    </>
                  ) : (
                    <div style={{ textAlign: "center", padding: "36px 20px" }}>
                      <div className="font-display" style={{ fontSize: 68, fontWeight: 900, letterSpacing: "-0.04em", color: "#5cffb1", lineHeight: 0.88, marginBottom: 12 }}>A</div>
                      <div className="font-display" style={{ fontSize: 15, fontWeight: 600, color: "#5cffb1", marginBottom: 5 }}>Clean contract</div>
                      <p className="font-sans-switzer" style={{ fontSize: 13, color: "rgba(255,255,255,0.28)" }}>No findings across all analysis layers.</p>
                    </div>
                  )}
                </div>
              )}

              {(isDone || isFailed) && (
                <div style={{ textAlign: "center", paddingTop: 4 }}>
                  <Link href="/app" className="font-display" style={{ fontSize: 12, color: "#b8b4ff", textDecoration: "none", opacity: 0.6 }}>← Run another audit</Link>
                </div>
              )}
            </div>

            {/* ── RIGHT SIDEBAR ── */}
            <div style={{ display: "flex", flexDirection: "column", gap: 12, position: "sticky", top: 62 }}>

              {/* Pipeline */}
              <div style={{ ...CARD, padding: "16px 16px 18px" }}>
                <div className="font-display" style={{ fontSize: 10.5, fontWeight: 600, color: "rgba(255,255,255,0.28)", marginBottom: 14 }}>Analysis Pipeline</div>
                <Pipeline job={job} />
              </div>

              {/* Provenance */}
              {isDone && (
                <div style={{ ...CARD, padding: "16px 16px 18px" }}>
                  <div className="font-display" style={{ fontSize: 10.5, fontWeight: 600, color: "rgba(255,255,255,0.28)", marginBottom: 12 }}>Provenance</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    {job.blobId ? (
                      <div>
                        <div className="font-display" style={{ fontSize: 9, color: "rgba(184,180,255,0.38)", textTransform: "uppercase" as const, letterSpacing: "0.14em", marginBottom: 5 }}>Walrus Blob</div>
                        <a href={`https://aggregator.walrus-testnet.walrus.space/v1/blobs/${job.blobId}`} target="_blank" rel="noopener noreferrer" className="font-mono-plex" style={{ fontSize: 9.5, color: "#4da2ff", wordBreak: "break-all", lineHeight: 1.5, display: "block" }}>
                          {job.blobId}
                        </a>
                        <div className="font-display" style={{ fontSize: 9, color: "rgba(255,255,255,0.18)", marginTop: 3 }}>AES-256 · 5 epochs</div>
                      </div>
                    ) : (
                      <div>
                        <div className="font-display" style={{ fontSize: 9, color: "rgba(184,180,255,0.38)", textTransform: "uppercase" as const, letterSpacing: "0.14em", marginBottom: 4 }}>Walrus Blob</div>
                        <div className="font-display" style={{ fontSize: 10, color: "rgba(255,255,255,0.18)" }}>Not uploaded</div>
                      </div>
                    )}
                    {job.txDigest && (
                      <div>
                        <div className="font-display" style={{ fontSize: 9, color: "rgba(184,180,255,0.38)", textTransform: "uppercase" as const, letterSpacing: "0.14em", marginBottom: 5 }}>MVR Tx</div>
                        <a href={`https://suiscan.xyz/testnet/tx/${job.txDigest}`} target="_blank" rel="noopener noreferrer" className="font-mono-plex" style={{ fontSize: 9.5, color: "#4da2ff", wordBreak: "break-all" }}>
                          {job.txDigest}
                        </a>
                      </div>
                    )}
                    <div>
                      <div className="font-display" style={{ fontSize: 9, color: "rgba(184,180,255,0.38)", textTransform: "uppercase" as const, letterSpacing: "0.14em", marginBottom: 5 }}>Seal</div>
                      <span className="font-display" style={{ fontSize: 9.5, padding: "2px 8px", borderRadius: 99, background: report?.sealed ? "rgba(92,255,177,0.07)" : "rgba(255,255,255,0.04)", color: report?.sealed ? "#5cffb1" : "rgba(255,255,255,0.22)", border: `1px solid ${report?.sealed ? "rgba(92,255,177,0.18)" : "rgba(255,255,255,0.06)"}` }}>
                        {report?.sealed ? "IBE encrypted" : "Plaintext fallback"}
                      </span>
                    </div>
                    {report && (
                      <div>
                        <div className="font-display" style={{ fontSize: 9, color: "rgba(184,180,255,0.38)", textTransform: "uppercase" as const, letterSpacing: "0.14em", marginBottom: 4 }}>Generated</div>
                        <div className="font-sans-switzer" style={{ fontSize: 11, color: "rgba(255,255,255,0.35)" }}>
                          {new Date(report.generated_at).toLocaleString()}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Watermark */}
              <div style={{ padding: "10px 13px", borderRadius: 11, background: "rgba(255,193,92,0.03)", border: "1px solid rgba(255,193,92,0.07)" }}>
                <p className="font-display" style={{ fontSize: 9, color: "rgba(255,193,92,0.38)", lineHeight: 1.55, textAlign: "center" }}>
                  Automated pre-screen — not a substitute for a human audit.
                </p>
              </div>
            </div>

          </div>
        )}
      </main>

      <footer style={{ borderTop: "1px solid rgba(184,180,255,0.06)", padding: "11px 28px", textAlign: "center" }}>
        <span className="font-display" style={{ fontSize: 10.5, color: "rgba(255,255,255,0.15)" }}>
          Automated pre-screen — not a substitute for a human audit. · Sui Overflow 2026 · Walrus Track
        </span>
      </footer>
    </div>
  );
}
