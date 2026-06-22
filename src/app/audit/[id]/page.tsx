"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

// ── Types ─────────────────────────────────────────────────────────────────────

type AuditStatus = "queued"|"cloning"|"fetching"|"auditing"|"encrypting"|"uploading"|"linking"|"done"|"failed";
type Severity = "critical"|"high"|"medium"|"low";
type FindingSource = "layer1"|"layer2"|"layer3"|"layer4"|"layer1_confirmed"|"layer2_oz"|"layer4_groq";

interface Finding {
  rule_id: string; severity: Severity; confidence: number; source: FindingSource;
  module: string; line_start: number; line_end: number;
  description: string; recommendation: string; category: string;
  patch_before?: string|null; patch_after?: string|null;
  confidence_reason?: string; groq_reasoning?: string|null;
}
interface DismissedSuspect {
  rule_id: string; title: string; reason: string;
  location: { module:string; function:string|null; line_start:number; line_end:number };
}
interface UnreviewedHint {
  rule_id: string; title: string; description: string; hint_reason: string;
  location: { module:string; function:string|null; line_start:number; line_end:number };
  severity: Severity;
}
interface AuditScore {
  overall: number; grade: "A"|"B"|"C"|"D"|"F";
  dimensions: {
    accessControl:number; arithmeticSafety:number; upgradeability:number;
    codeQuality:number; ozCompliance:number;
  };
  exploitability: "critical"|"high"|"medium"|"low"|"minimal";
  confirmed_count:number; dismissed_count:number; unreviewed_count:number;
  false_positive_rate:number;
}
interface SeverityCounts { critical:number; high:number; medium:number; low:number }
interface FullReport {
  id:string; status:string; watermark:string; report_id:string; generated_at:string;
  package:{
    packageId:string; network:string; mvrName?:string|null; version:number; moduleCount:number;
    sourceRepo?:string|null; inputType?:string; fileCount?:number; cappedAt?:number|null;
  };
  risk_grade:"A"|"B"|"C"|"D"|"F";
  severity_counts:SeverityCounts;
  score?:AuditScore|null;
  layer4_used:boolean; memory_context_used:boolean; layer3_hits?:number;
  sealed:boolean; findings:Finding[];
  dismissed?: DismissedSuspect[];
  unreviewed?: UnreviewedHint[];
  blobId?:string|null; txDigest?:string|null;
}
interface JobStatus {
  id:string; status:AuditStatus; stagesVisited:AuditStatus[];
  blobId?:string|null; txDigest?:string|null; error?:string|null;
  degraded?:boolean; updatedAt:string;
}

// ── Tokens ────────────────────────────────────────────────────────────────────

const BG      = "#0A0A0A";
const SURFACE = "#111111";
const BORDER  = "rgba(255,255,255,0.06)";
const BORDER5 = "rgba(255,255,255,0.05)";
const CARD: React.CSSProperties = { background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 16 };

const SEV: Record<Severity, string> = {
  critical:"#F87171", high:"#FB923C", medium:"#FBBF24", low:"#5cc9f5",
};
const SEV_LABEL: Record<Severity,string> = {
  critical:"Critical", high:"High", medium:"Medium", low:"Low",
};
const GRADE_COLOR: Record<string,string> = {
  A:"#4ade80", B:"#34d399", C:"#FBBF24", D:"#FB923C", F:"#F87171",
};
const GRADE_LABEL: Record<string,string> = {
  A:"Clean", B:"Low Risk", C:"Medium Risk", D:"High Risk", F:"Critical Risk",
};

const SOURCE_LABEL: Record<FindingSource,string> = {
  layer1:            "Rules Engine (Layer 1)",
  layer2:            "OZ Benchmarking (Layer 2)",
  layer3:            "Semantic Memory (Layer 3)",
  layer4:            "ML Analysis (Layer 4)",
  layer1_confirmed:  "Rules Engine · AI Confirmed",
  layer2_oz:         "OZ Benchmarking (Layer 2)",
  layer4_groq:       "Groq ML Analysis",
};

const TERMINAL: AuditStatus[] = ["done","failed"];

const EYE: React.CSSProperties = {
  fontSize:10, fontWeight:600, letterSpacing:"0.16em",
  color:"rgba(255,255,255,0.22)", textTransform:"uppercase",
  marginBottom:16, fontFamily:"var(--font-display)",
};

// ── Loading screen ────────────────────────────────────────────────────────────

const STAGE_LABEL: Record<AuditStatus, string> = {
  queued:     "Queued",
  cloning:    "Cloning Repository",
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
  cloning:    "Shallow-cloning repo · finding .move files",
  fetching:   "Pulling modules via Sui GraphQL",
  auditing:   "65 rules · OZ benchmarks · LanceDB recall · Groq ML",
  encrypting: "IBE threshold encryption via Seal",
  uploading:  "5-epoch permanent storage",
  linking:    "Writing blob ID via MVR on-chain tx",
  done:       "Report ready",
  failed:     "An error occurred",
};

function LoadingScreen({ job }: { job:JobStatus }) {
  return (
    <div style={{
      position:"relative", minHeight:"calc(100vh - 104px)", overflow:"hidden",
      display:"flex", flexDirection:"column",
      alignItems:"center", justifyContent:"center", padding:"80px 28px", textAlign:"center",
    }}>
      {/* Aurora — fixed, full-viewport cover, no gradient overlays */}
      <div style={{ position:"fixed", inset:0, pointerEvents:"none", zIndex:0 }}>
        <img src="/Aurora.png" alt="" style={{ width:"100%", height:"100%", objectFit:"cover", objectPosition:"center top", opacity:0.92 }} />
      </div>

      {/* Content above aurora */}
      <div style={{ position:"relative", zIndex:1, display:"flex", flexDirection:"column", alignItems:"center" }}>
        <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:36 }}>
          <div style={{ width:8, height:8, borderRadius:"50%", background:"#b8b4ff", boxShadow:"0 0 14px rgba(184,180,255,0.9)", animation:"mlPulse 1.5s ease-in-out infinite" }} />
          <span className="font-display" style={{ fontSize:12, color:"rgba(184,180,255,0.6)", letterSpacing:"0.16em", textTransform:"uppercase" as const }}>In Progress</span>
        </div>

        <h1 className="font-display" style={{
          fontSize:"clamp(52px, 9vw, 96px)", fontWeight:800,
          letterSpacing:"-0.04em", color:"#fff", lineHeight:0.92, marginBottom:22,
          textShadow:"0 2px 40px rgba(184,180,255,0.18)",
        }}>
          {STAGE_LABEL[job.status]}
        </h1>

        <p className="font-sans-switzer" style={{
          fontSize:"clamp(14px, 2vw, 17px)", color:"rgba(255,255,255,0.38)",
          maxWidth:460, lineHeight:1.65, marginBottom:56,
        }}>
          {STAGE_SUB[job.status]}
        </p>

        <div style={{ width:"min(300px, 80vw)", height:2, borderRadius:99, background:"rgba(184,180,255,0.1)", overflow:"hidden" }}>
          <div style={{
            height:"100%", width:"45%", borderRadius:99,
            background:"linear-gradient(90deg, transparent, #b8b4ff, transparent)",
            animation:"mlMarquee 2s linear infinite",
          }} />
        </div>

        <div className="font-mono-plex" style={{ marginTop:36, fontSize:11, color:"rgba(255,255,255,0.18)", wordBreak:"break-all", maxWidth:500 }}>
          {job.id}
        </div>
      </div>
    </div>
  );
}

// ── Risk distribution (alternative: labeled bars with glow) ───────────────────

function RiskDistribution({ counts }: { counts:SeverityCounts }) {
  const total = counts.critical + counts.high + counts.medium + counts.low;
  if (total === 0) return null;
  const max = Math.max(counts.critical, counts.high, counts.medium, counts.low, 1);

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
      {(["critical","high","medium","low"] as Severity[]).map(sev => {
        const count = counts[sev];
        if (count === 0) return null;
        const pct  = Math.round((count / total) * 100);
        const fill = Math.round((count / max) * 100);
        const col  = SEV[sev];
        return (
          <div key={sev}>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:8 }}>
              <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                <div style={{ width:7, height:7, borderRadius:"50%", background:col, flexShrink:0 }} />
                <span className="font-display" style={{ fontSize:11, fontWeight:600, letterSpacing:"0.08em", color:"rgba(255,255,255,0.5)", textTransform:"uppercase" as const }}>
                  {SEV_LABEL[sev]}
                </span>
              </div>
              <div style={{ display:"flex", alignItems:"baseline", gap:10 }}>
                <span className="font-display" style={{ fontSize:20, fontWeight:700, letterSpacing:"-0.02em", color:col }}>{count}</span>
                <span className="font-display" style={{ fontSize:11, color:"rgba(255,255,255,0.28)" }}>{pct}%</span>
              </div>
            </div>
            <div style={{ height:8, borderRadius:4, background:"rgba(255,255,255,0.05)", overflow:"hidden" }}>
              <div style={{
                height:"100%", borderRadius:4, background:col, opacity:0.72,
                width:`${fill}%`, transition:"width 0.9s cubic-bezier(0.4,0,0.2,1)",
                boxShadow:`0 0 10px ${col}55`,
              }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Category list ─────────────────────────────────────────────────────────────

function CategoryList({ findings }: { findings:Finding[] }) {
  const cats = useMemo(() => {
    const m: Record<string,{ count:number; topSev:Severity }> = {};
    const rank: Record<Severity,number> = { critical:4, high:3, medium:2, low:1 };
    for (const f of findings) {
      if (!m[f.category]) m[f.category] = { count:0, topSev:"low" };
      m[f.category].count++;
      if (rank[f.severity] > rank[m[f.category].topSev]) m[f.category].topSev = f.severity;
    }
    return Object.entries(m).sort((a,b) => b[1].count - a[1].count);
  }, [findings]);

  const max = cats[0]?.[1].count ?? 1;
  return (
    <div style={{ ...CARD, overflow:"hidden" }}>
      {cats.map(([cat, { count, topSev }], i) => (
        <div key={cat} style={{ padding:"18px 28px", borderBottom: i < cats.length-1 ? `1px solid ${BORDER5}` : "none" }}>
          <div style={{ display:"flex", alignItems:"baseline", justifyContent:"space-between", marginBottom:10 }}>
            <span className="font-display" style={{ fontSize:14, fontWeight:500, color:"rgba(255,255,255,0.75)" }}>{cat}</span>
            <span className="font-display" style={{ fontSize:12, color:"rgba(255,255,255,0.3)", marginLeft:16, whiteSpace:"nowrap" }}>{count} findings</span>
          </div>
          <div style={{ height:3, background:"rgba(255,255,255,0.05)", borderRadius:2, overflow:"hidden" }}>
            <div style={{
              height:"100%", borderRadius:2,
              width:`${Math.round((count/max)*100)}%`,
              background: SEV[topSev], opacity:0.55,
              transition:"width 0.9s cubic-bezier(0.4,0,0.2,1)",
            }} />
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Finding card ──────────────────────────────────────────────────────────────

function FindingCard({ finding }: { finding:Finding }) {
  const [open, setOpen] = useState(false);
  const col = SEV[finding.severity];
  const pct = Math.round(finding.confidence * 100);

  return (
    <div style={{
      background:SURFACE, borderRadius:12, overflow:"hidden",
      border:`1px solid ${BORDER}`, borderLeft:`3px solid ${col}`,
    }}>
      <button type="button" onClick={() => setOpen(v=>!v)}
        style={{ width:"100%", textAlign:"left", padding:"18px 22px", display:"flex", alignItems:"center", gap:14, cursor:"pointer", background:"transparent", border:"none" }}>
        <div style={{ width:8, height:8, borderRadius:"50%", background:col, flexShrink:0 }} />
        <div style={{ flex:1, minWidth:0 }}>
          <div className="font-display" style={{ fontSize:14, fontWeight:500, color:"#fff", lineHeight:1.35, marginBottom:5, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
            {finding.description}
          </div>
          <div style={{ display:"flex", gap:14, alignItems:"center" }}>
            <span className="font-mono-plex" style={{ fontSize:11, color:"rgba(255,255,255,0.27)" }}>{finding.rule_id}</span>
            <span className="font-display"   style={{ fontSize:11, color:"rgba(255,255,255,0.22)" }}>{finding.module}</span>
            <span className="font-display"   style={{ fontSize:11, color:"rgba(255,255,255,0.22)" }}>Line {finding.line_start}</span>
          </div>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:10, flexShrink:0 }}>
          <span className="font-display" style={{ fontSize:10, fontWeight:600, letterSpacing:"0.1em", color:col, textTransform:"uppercase" as const, whiteSpace:"nowrap" }}>
            {SEV_LABEL[finding.severity]}
          </span>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"
            style={{ transform:open?"rotate(180deg)":"none", transition:"transform 0.2s", color:"rgba(255,255,255,0.22)", flexShrink:0 }}>
            <path d="M3 5L7 9L11 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
      </button>

      {open && (
        <div style={{ borderTop:`1px solid ${BORDER5}`, padding:"28px", display:"flex", flexDirection:"column", gap:24, background:"#0D0D0D" }}>
          <div>
            <div className="font-display" style={{ fontSize:10, fontWeight:600, letterSpacing:"0.14em", color:"rgba(255,255,255,0.2)", textTransform:"uppercase" as const, marginBottom:10 }}>Description</div>
            <p className="font-sans-switzer" style={{ fontSize:14, lineHeight:1.72, color:"rgba(255,255,255,0.58)", margin:0 }}>{finding.description}</p>
          </div>
          <div>
            <div className="font-display" style={{ fontSize:10, fontWeight:600, letterSpacing:"0.14em", color:"rgba(255,255,255,0.2)", textTransform:"uppercase" as const, marginBottom:10 }}>Recommended Fix</div>
            <p className="font-sans-switzer" style={{ fontSize:14, lineHeight:1.72, color:"rgba(255,255,255,0.58)", margin:0 }}>{finding.recommendation}</p>
          </div>
          <div style={{ display:"flex", gap:32, paddingTop:20, borderTop:`1px solid ${BORDER5}` }}>
            <div>
              <div className="font-display" style={{ fontSize:10, color:"rgba(255,255,255,0.2)", marginBottom:5, textTransform:"uppercase" as const, letterSpacing:"0.12em" }}>Confidence</div>
              <div className="font-display" style={{ fontSize:13, fontWeight:500, color:"rgba(255,255,255,0.55)" }}
                title={finding.confidence_reason ?? undefined}>{pct}%</div>
            </div>
            <div>
              <div className="font-display" style={{ fontSize:10, color:"rgba(255,255,255,0.2)", marginBottom:5, textTransform:"uppercase" as const, letterSpacing:"0.12em" }}>Analysis Layer</div>
              <div className="font-display" style={{ fontSize:13, fontWeight:500, color:"rgba(255,255,255,0.55)" }}>{SOURCE_LABEL[finding.source] ?? finding.source}</div>
            </div>
          </div>
          {finding.groq_reasoning && (
            <div style={{ marginTop:4, padding:"10px 14px", borderRadius:8, background:"rgba(99,102,241,0.08)", border:"1px solid rgba(99,102,241,0.15)" }}>
              <span className="font-display" style={{ fontSize:11, fontWeight:600, color:"rgba(99,102,241,0.7)", marginRight:6 }}>AI Review:</span>
              <span className="font-sans-switzer" style={{ fontSize:12, color:"rgba(255,255,255,0.45)", lineHeight:1.55 }}>{finding.groq_reasoning}</span>
            </div>
          )}
          {finding.patch_after && (
            <div>
              <div className="font-display" style={{ fontSize:10, fontWeight:600, letterSpacing:"0.14em", color:"rgba(255,255,255,0.2)", textTransform:"uppercase" as const, marginBottom:12 }}>Suggested Patch</div>
              <div style={{ border:"1px solid rgba(255,255,255,0.07)", borderRadius:12, overflow:"hidden" }}>
                <div style={{ display:"grid", gridTemplateColumns: finding.patch_before ? "1fr 1fr" : "1fr" }}>
                  {finding.patch_before && (
                    <div style={{ borderRight:"1px solid rgba(255,255,255,0.07)" }}>
                      <div style={{ padding:"10px 16px", background:"rgba(248,113,113,0.05)", borderBottom:"1px solid rgba(255,255,255,0.06)" }}>
                        <span className="font-display" style={{ fontSize:11, fontWeight:500, color:"rgba(248,113,113,0.55)", letterSpacing:"0.04em" }}>Before</span>
                      </div>
                      <pre className="font-mono-plex" style={{ padding:"20px 18px", fontSize:12, lineHeight:1.75, color:"rgba(255,255,255,0.42)", overflowX:"auto", margin:0, background:"transparent", whiteSpace:"pre" }}>
                        {finding.patch_before}
                      </pre>
                    </div>
                  )}
                  <div>
                    <div style={{ padding:"10px 16px", background:"rgba(74,222,128,0.05)", borderBottom:"1px solid rgba(255,255,255,0.06)", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                      <span className="font-display" style={{ fontSize:11, fontWeight:500, color:"rgba(74,222,128,0.55)", letterSpacing:"0.04em" }}>After</span>
                      <button type="button" onClick={() => void navigator.clipboard.writeText(finding.patch_after!)}
                        className="font-display" style={{ background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.08)", borderRadius:5, padding:"3px 10px", fontSize:10, color:"rgba(255,255,255,0.32)", cursor:"pointer", letterSpacing:"0.03em" }}>
                        Copy
                      </button>
                    </div>
                    <pre className="font-mono-plex" style={{ padding:"20px 18px", fontSize:12, lineHeight:1.75, color:"rgba(255,255,255,0.42)", overflowX:"auto", margin:0, background:"transparent", whiteSpace:"pre" }}>
                      {finding.patch_after}
                    </pre>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AuditPage() {
  const params  = useParams<{ id:string }>();
  const auditId = params.id;

  const [job,     setJob]     = useState<JobStatus|null>(null);
  const [report,  setReport]  = useState<FullReport|null>(null);
  const [err,     setErr]     = useState<string|null>(null);
  const [showAll, setShowAll] = useState(false);

  const pollJob = useCallback(async () => {
    try {
      const res = await fetch(`/api/audit?id=${auditId}`);
      if (!res.ok) { setErr(`HTTP ${res.status}`); return; }
      const data = await res.json() as JobStatus;
      setJob(data);
      if (data.status === "done") {
        const rr = await fetch(`/api/report/${auditId}`);
        if (rr.ok) setReport(await rr.json() as FullReport);
      }
    } catch (e) { console.warn("[audit]", e); }
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

  const grade      = report?.score?.grade ?? report?.risk_grade ?? "F";
  const gradeColor = GRADE_COLOR[grade];
  const riskScore  = report?.score?.overall ?? (grade === "A" ? 95 : grade === "B" ? 80 : grade === "C" ? 60 : grade === "D" ? 40 : 20);
  const { critical=0, high=0, medium=0, low=0 } = report?.severity_counts ?? {};
  const total = critical + high + medium + low;

  const avgConf = useMemo(() => {
    if (!report?.findings.length) return 0;
    return Math.round((report.findings.reduce((s,f) => s+f.confidence, 0) / report.findings.length) * 100);
  }, [report]);

  const byLayer = useMemo(() => {
    if (!report) return { layer1:0, layer2:0, layer3:0, layer4:0 };
    const m = { layer1:0, layer2:0, layer3:0, layer4:0 };
    for (const f of report.findings) (m as Record<string,number>)[f.source]++;
    return m;
  }, [report]);

  const LIMIT = 5;
  const shown = report ? (showAll ? report.findings : report.findings.slice(0, LIMIT)) : [];

  return (
    <div style={{ minHeight:"100vh", background:BG, color:"#fff", position:"relative" }}>

      {/* ── NAV ─────────────────────────────────────────────────────────────── */}
      <nav style={{
        position:"fixed", top:0, left:0, right:0, zIndex:100,
        background:"rgba(10,10,10,0.72)", backdropFilter:"blur(16px)",
        WebkitBackdropFilter:"blur(16px)", borderBottom:"1px solid rgba(255,255,255,0.06)",
        display:"flex", alignItems:"center", padding:"20px 32px",
      }}>
        <div style={{ display:"flex", alignItems:"center", gap:20, flex:1, minWidth:0 }}>
          <Link href="/" style={{ display:"flex", alignItems:"center", gap:9, textDecoration:"none", flexShrink:0 }}>
            <img src="/Logo.png" alt="MoveLens" style={{ height:64 }} />
          </Link>
          <div style={{ width:1, height:16, background:"rgba(255,255,255,0.1)", flexShrink:0 }} />
          <div style={{ display:"flex", alignItems:"center", gap:6, overflow:"hidden", minWidth:0 }}>
            <span className="font-display" style={{ fontSize:13, color:"rgba(255,255,255,0.3)", whiteSpace:"nowrap", flexShrink:0 }}>Audits</span>
            <span style={{ fontSize:13, color:"rgba(255,255,255,0.15)", flexShrink:0 }}>/</span>
            <span className="font-display" style={{ fontSize:13, fontWeight:500, color:"rgba(255,255,255,0.65)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
              {report?.package.mvrName ?? auditId}
            </span>
          </div>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:7, flexShrink:0 }}>
          {isDone   && <><div style={{ width:6, height:6, borderRadius:"50%", background:"#4ade80" }} /><span className="font-display" style={{ fontSize:12, fontWeight:500, color:"rgba(255,255,255,0.5)" }}>Completed</span></>}
          {isFailed && <><div style={{ width:6, height:6, borderRadius:"50%", background:"#F87171" }} /><span className="font-display" style={{ fontSize:12, fontWeight:500, color:"rgba(255,255,255,0.5)" }}>Failed</span></>}
          {isLive   && <><div style={{ width:6, height:6, borderRadius:"50%", background:"#FBBF24", animation:"mlPulse 1.5s ease-in-out infinite" }} /><span className="font-display" style={{ fontSize:12, fontWeight:500, color:"rgba(255,255,255,0.5)" }}>Analyzing</span></>}
        </div>
      </nav>

      {/* Fixed nav spacer */}
      <div style={{ height:104, position:"relative", zIndex:10 }} />

      {/* ── Content ──────────────────────────────────────────────────────────── */}
      <div style={{ position:"relative", zIndex:10 }}>

        {err && (
          <div style={{ maxWidth:1400, margin:"20px auto", padding:"0 40px" }}>
            <div className="font-sans-switzer" style={{ padding:16, borderRadius:12, background:"rgba(248,113,113,0.06)", border:"1px solid rgba(248,113,113,0.2)", color:"#F87171", fontSize:14 }}>
              Failed to load: {err}
            </div>
          </div>
        )}

        {/* Spinner while waiting for first job data */}
        {!job && !err && (
          <div style={{ minHeight:"80vh", display:"flex", alignItems:"center", justifyContent:"center" }}>
            <div style={{ width:34, height:34, borderRadius:"50%", border:"2px solid rgba(139,141,255,0.18)", borderTopColor:"#8B8DFF", animation:"mlSpin 0.9s linear infinite" }} />
          </div>
        )}

        {/* Pipeline running */}
        {isLive && <LoadingScreen job={job} />}

        {/* Failed */}
        {isFailed && (
          <div style={{ minHeight:"80vh", display:"flex", alignItems:"center", justifyContent:"center", padding:"80px 24px" }}>
            <div style={{ width:520, ...CARD, padding:48, textAlign:"center" }}>
              <div className="font-display" style={{ fontSize:64, fontWeight:700, letterSpacing:"-0.04em", color:"#F87171", lineHeight:1, marginBottom:14 }}>!</div>
              <div className="font-display" style={{ fontSize:18, fontWeight:600, color:"#fff", marginBottom:8 }}>Audit Failed</div>
              {job?.error && <p className="font-sans-switzer" style={{ fontSize:14, color:"rgba(255,255,255,0.35)", lineHeight:1.65, marginBottom:28 }}>{job.error}</p>}
              <Link href="/app" className="font-display" style={{ fontSize:13, color:"#8B8DFF", textDecoration:"none" }}>← Try again</Link>
            </div>
          </div>
        )}

        {/* Clean contract */}
        {isDone && report && total === 0 && (
          <div style={{ minHeight:"80vh", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:"80px 24px", gap:24 }}>
            <div className="font-display" style={{ fontSize:168, fontWeight:700, lineHeight:1, letterSpacing:"-0.06em", color:"#fff" }}>100</div>
            <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:10 }}>
              <div className="font-display" style={{ fontSize:11, fontWeight:600, letterSpacing:"0.14em", color:"#4ade80", textTransform:"uppercase" as const }}>No Issues Found</div>
              <p className="font-sans-switzer" style={{ fontSize:14, color:"rgba(255,255,255,0.35)", textAlign:"center", maxWidth:380, lineHeight:1.7, margin:0 }}>
                This package passed all audit checks across 4 analysis layers. No vulnerabilities, anti-patterns, or logic errors were detected.
              </p>
            </div>
            <Link href="/app" className="font-display" style={{ fontSize:13, color:"#8B8DFF", textDecoration:"none", marginTop:8 }}>← Run another audit</Link>
          </div>
        )}

        {/* ── FULL REPORT ── */}
        {isDone && report && total > 0 && (
          <div style={{ maxWidth:1400, margin:"0 auto", padding:"0 40px" }}>

            {/* HERO */}
            <div style={{ padding:"80px 0 72px", display:"flex", alignItems:"flex-start", justifyContent:"space-between", gap:48, borderBottom:`1px solid ${BORDER}` }}>
              <div style={{ flex:1, minWidth:0 }}>
                <div className="font-display" style={EYE}>Security Report</div>
                <div className="font-display" style={{ fontSize:44, fontWeight:700, color:"#fff", letterSpacing:"-0.03em", lineHeight:1.08, marginBottom:10 }}>
                  {report.package.inputType === "git" ? "GitHub Repository Audit" : "Move Package Audit"}
                </div>
                <div className="font-display" style={{ fontSize:24, fontWeight:400, color:"rgba(255,255,255,0.45)", letterSpacing:"-0.015em", marginBottom:36 }}>
                  {report.package.inputType === "git"
                    ? report.package.packageId.replace("github:", "")
                    : (report.package.mvrName ?? `${report.package.packageId.slice(0,20)}…`)}
                </div>

                <div style={{ marginBottom:40 }}>
                  {report.package.inputType === "git" && report.package.sourceRepo ? (
                    <a href={report.package.sourceRepo} target="_blank" rel="noopener noreferrer"
                      style={{ display:"inline-flex", alignItems:"center", gap:10, padding:"10px 16px", background:SURFACE, border:"1px solid rgba(255,255,255,0.07)", borderRadius:10, textDecoration:"none" }}>
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ flexShrink:0 }}>
                        <path d="M6 1C3.24 1 1 3.24 1 6c0 2.21 1.43 4.09 3.42 4.75.25.05.34-.11.34-.24v-.85c-1.39.3-1.68-.67-1.68-.67-.23-.58-.56-.73-.56-.73-.46-.31.03-.31.03-.31.5.03.77.52.77.52.45.77 1.18.55 1.47.42.04-.33.18-.55.32-.68-1.12-.13-2.29-.56-2.29-2.49 0-.55.2-1 .52-1.35-.05-.13-.23-.64.05-1.33 0 0 .42-.14 1.38.51.4-.11.83-.17 1.26-.17.43 0 .86.06 1.26.17.96-.65 1.38-.51 1.38-.51.28.69.1 1.2.05 1.33.32.35.52.8.52 1.35 0 1.94-1.18 2.36-2.3 2.49.18.16.34.47.34.94v1.4c0 .13.09.29.34.24C9.57 10.09 11 8.21 11 6c0-2.76-2.24-5-5-5z" fill="rgba(255,255,255,0.3)"/>
                      </svg>
                      <span className="font-mono-plex" style={{ fontSize:12, color:"rgba(255,255,255,0.5)", letterSpacing:"0.04em" }}>
                        {report.package.sourceRepo.replace("https://", "")}
                      </span>
                    </a>
                  ) : (
                    <div style={{ display:"inline-flex", alignItems:"center", gap:10, padding:"10px 16px", background:SURFACE, border:"1px solid rgba(255,255,255,0.07)", borderRadius:10 }}>
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ flexShrink:0 }}>
                        <rect x="1.5" y="1.5" width="9" height="9" rx="1.5" stroke="rgba(255,255,255,0.2)" strokeWidth="1.2" fill="none"/>
                        <path d="M4 6h4" stroke="rgba(255,255,255,0.2)" strokeWidth="1.2" strokeLinecap="round"/>
                      </svg>
                      <span className="font-mono-plex" style={{ fontSize:12, color:"rgba(255,255,255,0.32)", letterSpacing:"0.04em" }}>
                        {report.package.packageId.slice(0,10)}…{report.package.packageId.slice(-8)}
                      </span>
                    </div>
                  )}
                </div>

                {report.package.inputType === "git" && report.package.cappedAt !== null && report.package.cappedAt !== undefined && (
                  <div style={{ marginBottom:24, padding:"10px 16px", background:"rgba(251,191,36,0.06)", border:"1px solid rgba(251,191,36,0.2)", borderRadius:10 }}>
                    <span className="font-display" style={{ fontSize:12, color:"#FBBF24" }}>
                      ⚠ Large repo — showing findings from first {report.package.cappedAt} files only
                    </span>
                  </div>
                )}

                <div style={{ display:"flex", gap:48, flexWrap:"wrap" }}>
                  {(report.package.inputType === "git" ? [
                    { label:"Files",     val: String(report.package.fileCount ?? report.package.moduleCount) },
                    { label:"Modules",   val: String(report.package.moduleCount) },
                    { label:"Network",   val: report.package.network[0].toUpperCase()+report.package.network.slice(1) },
                    { label:"Generated", val: new Date(report.generated_at).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"}) },
                  ] : [
                    { label:"Modules",   val: String(report.package.moduleCount) },
                    { label:"Version",   val: `v${report.package.version}` },
                    { label:"Network",   val: report.package.network[0].toUpperCase()+report.package.network.slice(1) },
                    { label:"Generated", val: new Date(report.generated_at).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"}) },
                  ]).map(({ label, val }) => (
                    <div key={label}>
                      <div className="font-display" style={{ fontSize:11, color:"rgba(255,255,255,0.25)", marginBottom:6, letterSpacing:"0.04em" }}>{label}</div>
                      <div className="font-display" style={{ fontSize:15, fontWeight:500, color:"rgba(255,255,255,0.75)" }}>{val}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Score */}
              <div style={{ flexShrink:0, textAlign:"right" }}>
                <div className="font-display" style={{ fontSize:132, fontWeight:700, lineHeight:1, letterSpacing:"-0.055em", color:gradeColor }}>
                  {riskScore}
                </div>
                <div className="font-display" style={{ fontSize:14, color:"rgba(255,255,255,0.28)", marginTop:4, letterSpacing:"0.01em" }}>out of 100</div>
                <div style={{ display:"inline-flex", alignItems:"center", gap:7, marginTop:18, padding:"7px 16px", background:`${gradeColor}12`, border:`1px solid ${gradeColor}28`, borderRadius:100 }}>
                  <div style={{ width:6, height:6, borderRadius:"50%", background:gradeColor, flexShrink:0 }} />
                  <span className="font-display" style={{ fontSize:11, fontWeight:600, letterSpacing:"0.1em", color:gradeColor, textTransform:"uppercase" as const }}>
                    {GRADE_LABEL[grade]}
                  </span>
                </div>
              </div>
            </div>

            {/* MAIN GRID */}
            <div style={{ display:"grid", gridTemplateColumns:"1fr 312px", gap:56, padding:"56px 0 96px", alignItems:"start" }}>

              {/* LEFT */}
              <div style={{ display:"flex", flexDirection:"column", gap:56, minWidth:0 }}>

                {/* Executive Summary */}
                <div>
                  <div className="font-display" style={EYE}>Executive Summary</div>
                  <div style={{ ...CARD, padding:"32px 36px", display:"grid", gridTemplateColumns:"repeat(5, 1fr)" }}>
                    {[
                      { label:"Risk Score", val:String(riskScore),                          col:gradeColor },
                      { label:"Findings",   val:String(total),                              col:"#fff" },
                      { label:"Critical",   val:String(critical),                           col:critical>0?"#F87171":"#fff" },
                      { label:"Modules",    val:String(report.package.moduleCount),         col:"#fff" },
                      { label:"Confidence", val:`${avgConf}%`,                              col:"#fff" },
                    ].map(({ label, val, col }, i, arr) => (
                      <div key={label} style={{
                        paddingRight: i<arr.length-1 ? 28 : 0,
                        paddingLeft:  i>0 ? 28 : 0,
                        borderRight:  i<arr.length-1 ? `1px solid ${BORDER}` : "none",
                      }}>
                        <div className="font-display" style={{ fontSize:36, fontWeight:700, letterSpacing:"-0.035em", lineHeight:1, marginBottom:9, color:col }}>{val}</div>
                        <div className="font-display" style={{ fontSize:10, color:"rgba(255,255,255,0.28)", letterSpacing:"0.1em", textTransform:"uppercase" as const }}>{label}</div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Severity Overview */}
                <div>
                  <div className="font-display" style={EYE}>Severity Overview</div>
                  <div style={{ display:"grid", gridTemplateColumns:"repeat(4, 1fr)", gap:12 }}>
                    {(["critical","high","medium","low"] as Severity[]).map(sev => {
                      const cnt   = report.severity_counts[sev];
                      const col   = SEV[sev];
                      const pct   = total>0 ? ((cnt/total)*100).toFixed(1) : "0.0";
                      const worst = sev==="critical" && cnt>0;
                      return (
                        <div key={sev} style={{ background:SURFACE, border:`1px solid ${worst ? col+"24" : BORDER}`, borderRadius:16, padding:"24px 20px" }}>
                          <div style={{ display:"flex", alignItems:"center", gap:7, marginBottom:20 }}>
                            <div style={{ width:7, height:7, borderRadius:"50%", background:col, flexShrink:0 }} />
                            <span className="font-display" style={{ fontSize:10, fontWeight:600, letterSpacing:"0.1em", color:worst?col:"rgba(255,255,255,0.4)", textTransform:"uppercase" as const }}>
                              {SEV_LABEL[sev]}
                            </span>
                          </div>
                          <div className="font-display" style={{ fontSize:42, fontWeight:700, color:"#fff", letterSpacing:"-0.04em", lineHeight:1, marginBottom:7 }}>{cnt}</div>
                          <div className="font-display" style={{ fontSize:11, color:"rgba(255,255,255,0.28)" }}>{pct}% of total</div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Risk Distribution */}
                <div>
                  <div className="font-display" style={EYE}>Risk Distribution</div>
                  <div style={{ ...CARD, padding:"32px 36px" }}>
                    <RiskDistribution counts={report.severity_counts} />
                  </div>
                </div>

                {/* Category Analysis */}
                <div>
                  <div className="font-display" style={EYE}>Category Analysis</div>
                  <CategoryList findings={report.findings} />
                </div>

                {/* Findings */}
                <div>
                  <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:16 }}>
                    <div className="font-display" style={{ ...EYE, marginBottom:0 }}>Findings</div>
                    <div className="font-display" style={{ fontSize:12, color:"rgba(255,255,255,0.25)" }}>
                      {total} total · showing {Math.min(showAll?total:LIMIT, total)}
                    </div>
                  </div>
                  <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                    {shown.map((f,i) => <FindingCard key={`${f.rule_id}-${i}`} finding={f} />)}
                    {!showAll && total > LIMIT && (
                      <button type="button" onClick={() => setShowAll(true)}
                        style={{ padding:"20px 24px", textAlign:"center", border:`1px solid ${BORDER5}`, borderRadius:12, background:SURFACE, cursor:"pointer" }}>
                        <span className="font-display" style={{ fontSize:13, color:"rgba(255,255,255,0.3)" }}>
                          Load {total-LIMIT} more findings
                        </span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Reviewed & Dismissed — transparency panel */}
                {(report.dismissed?.length ?? 0) > 0 && (
                  <div style={{ marginTop:8 }}>
                    <div className="font-display" style={{ ...EYE, marginBottom:12 }}>
                      Reviewed &amp; Dismissed ({report.dismissed!.length})
                    </div>
                    <p className="font-sans-switzer" style={{ fontSize:12, color:"rgba(255,255,255,0.3)", marginBottom:14, lineHeight:1.6 }}>
                      These patterns were detected by the rules engine but confirmed as false positives by Groq AI. They do <strong style={{ color:"rgba(255,255,255,0.4)" }}>not</strong> affect your score.
                    </p>
                    <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                      {report.dismissed!.map((d, i) => (
                        <div key={i} style={{ padding:"12px 16px", borderRadius:10, border:"1px solid rgba(255,255,255,0.05)", background:"rgba(74,222,128,0.03)", opacity:0.8 }}>
                          <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:4 }}>
                            <span className="font-display" style={{ fontSize:11, fontWeight:600, color:"#4ade80" }}>✓ Cleared</span>
                            <span className="font-mono-plex" style={{ fontSize:11, color:"rgba(255,255,255,0.3)" }}>{d.rule_id}</span>
                            <span className="font-display" style={{ fontSize:11, color:"rgba(255,255,255,0.2)" }}>—</span>
                            <span className="font-display" style={{ fontSize:11, color:"rgba(255,255,255,0.3)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{d.title}</span>
                          </div>
                          <div className="font-sans-switzer" style={{ fontSize:12, color:"rgba(255,255,255,0.28)", lineHeight:1.5 }}>
                            Line {d.location.line_start} in {d.location.module}: {d.reason}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Unreviewed Hints — shown with disclaimer, never scored */}
                {(report.unreviewed?.length ?? 0) > 0 && (
                  <div style={{ marginTop:8 }}>
                    <div style={{ padding:"16px 20px", borderRadius:12, border:"1px solid rgba(251,191,36,0.25)", background:"rgba(251,191,36,0.04)" }}>
                      <div className="font-display" style={{ fontSize:12, fontWeight:600, color:"#FBBF24", marginBottom:6 }}>
                        ⚠ {report.unreviewed!.length} Pattern(s) Not AI-Reviewed
                      </div>
                      <p className="font-sans-switzer" style={{ fontSize:12, color:"rgba(251,191,36,0.65)", lineHeight:1.6, margin:0 }}>
                        These patterns were detected but could not be reviewed by the AI gate (Groq unavailable or no API key). They are <strong>NOT</strong> included in your score. Manual review is recommended.
                      </p>
                      <div style={{ marginTop:12, display:"flex", flexDirection:"column", gap:5 }}>
                        {report.unreviewed!.slice(0, 5).map((h, i) => (
                          <div key={i} className="font-mono-plex" style={{ fontSize:11, color:"rgba(255,255,255,0.3)" }}>
                            {h.rule_id} @ {h.location.module}:{h.location.line_start} — {h.severity}
                          </div>
                        ))}
                        {report.unreviewed!.length > 5 && (
                          <div className="font-display" style={{ fontSize:11, color:"rgba(255,255,255,0.2)" }}>
                            + {report.unreviewed!.length - 5} more
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                <Link href="/app" className="font-display" style={{ fontSize:13, color:"#8B8DFF", textDecoration:"none", opacity:0.7, display:"block", paddingBottom:8 }}>
                  ← Run another audit
                </Link>
              </div>

              {/* SIDEBAR */}
              <div style={{ position:"sticky", top:88, display:"flex", flexDirection:"column", gap:14 }}>

                {/* Audit Snapshot */}
                <div style={{ ...CARD, padding:"22px 24px" }}>
                  <div className="font-display" style={{ fontSize:10, fontWeight:600, letterSpacing:"0.14em", color:"rgba(255,255,255,0.22)", textTransform:"uppercase" as const, marginBottom:18 }}>
                    Audit Snapshot
                  </div>
                  {([
                    { label:"Risk Score",     right: <span className="font-display" style={{ fontSize:13, fontWeight:600, color:gradeColor }}>{riskScore} / 100</span> },
                    { label:"Grade",          right: <span className="font-display" style={{ fontSize:14, fontWeight:700, color:gradeColor, letterSpacing:"-0.01em" }}>{grade}</span> },
                    { label:"Confirmed",      right: <span className="font-display" style={{ fontSize:13, fontWeight:600, color:"#fff" }}>{total}</span> },
                    ...(report.score ? [
                      { label:"Dismissed",    right: <span className="font-display" style={{ fontSize:13, color:"#4ade80" }}>{report.score.dismissed_count} cleared</span> },
                    ] : []),
                    { label:"Status",         right: <div style={{ display:"flex", alignItems:"center", gap:6 }}><div style={{ width:5, height:5, borderRadius:"50%", background:"#4ade80" }} /><span className="font-display" style={{ fontSize:13, fontWeight:500, color:"rgba(255,255,255,0.55)" }}>Completed</span></div> },
                  ] as { label:string; right:React.ReactNode }[]).map(({ label, right }, i, arr) => (
                    <div key={label} style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"11px 0", borderBottom: i<arr.length-1 ? `1px solid ${BORDER5}` : "none" }}>
                      <span className="font-display" style={{ fontSize:13, color:"rgba(255,255,255,0.38)" }}>{label}</span>
                      {right}
                    </div>
                  ))}
                </div>

                {/* Provenance */}
                <div style={{ ...CARD, padding:"22px 24px" }}>
                  <div className="font-display" style={{ fontSize:10, fontWeight:600, letterSpacing:"0.14em", color:"rgba(255,255,255,0.22)", textTransform:"uppercase" as const, marginBottom:18 }}>
                    Provenance
                  </div>
                  <div style={{ display:"flex", flexDirection:"column" }}>
                    <div style={{ padding:"11px 0", borderBottom:`1px solid ${BORDER5}` }}>
                      <div className="font-display" style={{ fontSize:11, color:"rgba(255,255,255,0.22)", marginBottom:5, letterSpacing:"0.04em" }}>Walrus Blob</div>
                      {job.blobId
                        ? <a href={`https://aggregator.walrus-testnet.walrus.space/v1/blobs/${job.blobId}`} target="_blank" rel="noopener noreferrer">
                            <span className="font-mono-plex" style={{ fontSize:11, color:"rgba(255,255,255,0.47)" }}>{job.blobId.slice(0,12)}…{job.blobId.slice(-8)}</span>
                          </a>
                        : <span className="font-mono-plex" style={{ fontSize:11, color:"rgba(255,255,255,0.2)" }}>Not uploaded</span>
                      }
                    </div>
                    {job.txDigest && (
                      <div style={{ padding:"11px 0", borderBottom:`1px solid ${BORDER5}` }}>
                        <div className="font-display" style={{ fontSize:11, color:"rgba(255,255,255,0.22)", marginBottom:5, letterSpacing:"0.04em" }}>Transaction</div>
                        <div style={{ display:"flex", alignItems:"center", gap:5 }}>
                          <a href={`https://suiscan.xyz/testnet/tx/${job.txDigest}`} target="_blank" rel="noopener noreferrer">
                            <span className="font-mono-plex" style={{ fontSize:11, color:"#8B8DFF" }}>{job.txDigest.slice(0,6)}…{job.txDigest.slice(-4)}</span>
                          </a>
                          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ flexShrink:0 }}>
                            <path d="M3 1.5H8.5V7M8.5 1.5L1.5 8.5" stroke="#8B8DFF" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        </div>
                      </div>
                    )}
                    <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"11px 0" }}>
                      <div className="font-display" style={{ fontSize:11, color:"rgba(255,255,255,0.22)", letterSpacing:"0.04em" }}>Seal Status</div>
                      <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                        <div style={{ width:5, height:5, borderRadius:"50%", background: report.sealed?"#4ade80":"rgba(255,255,255,0.22)" }} />
                        <span className="font-display" style={{ fontSize:11, color:"rgba(255,255,255,0.47)" }}>{report.sealed?"Verified":"Plaintext"}</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Analysis Layers */}
                <div style={{ ...CARD, padding:"22px 24px" }}>
                  <div className="font-display" style={{ fontSize:10, fontWeight:600, letterSpacing:"0.14em", color:"rgba(255,255,255,0.22)", textTransform:"uppercase" as const, marginBottom:18 }}>
                    Analysis Layers
                  </div>
                  {[
                    { name:"Rules Engine",    layer:"Layer 1", count:byLayer.layer1, on:true },
                    { name:"OZ Benchmarking", layer:"Layer 2", count:byLayer.layer2, on:true },
                    { name:"Semantic Memory", layer:"Layer 3", count:byLayer.layer3, on:report.memory_context_used },
                    { name:"ML Analysis",     layer:"Layer 4", count:byLayer.layer4, on:report.layer4_used },
                  ].map(({ name, layer, count, on }, i, arr) => (
                    <div key={layer} style={{ padding:"12px 0", borderBottom: i<arr.length-1 ? `1px solid ${BORDER5}` : "none", opacity:on?1:0.35 }}>
                      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:5 }}>
                        <span className="font-display" style={{ fontSize:12, fontWeight:500, color:"rgba(255,255,255,0.65)" }}>{name}</span>
                        <div style={{ display:"flex", alignItems:"center", gap:5 }}>
                          <div style={{ width:5, height:5, borderRadius:"50%", background:on?"#4ade80":"rgba(255,255,255,0.18)" }} />
                          <span className="font-display" style={{ fontSize:10, color:"rgba(255,255,255,0.28)" }}>{on?"Done":"Skipped"}</span>
                        </div>
                      </div>
                      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                        <span className="font-display" style={{ fontSize:11, color:"rgba(255,255,255,0.2)" }}>{layer}</span>
                        <span className="font-display" style={{ fontSize:11, color:"rgba(255,255,255,0.38)" }}>{count} findings</span>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Disclaimer */}
                <div style={{ ...CARD, padding:"20px 24px" }}>
                  <div className="font-display" style={{ fontSize:10, fontWeight:600, letterSpacing:"0.14em", color:"rgba(255,255,255,0.18)", textTransform:"uppercase" as const, marginBottom:10 }}>
                    Disclaimer
                  </div>
                  <p className="font-sans-switzer" style={{ fontSize:11, color:"rgba(255,255,255,0.24)", lineHeight:1.7, margin:0 }}>
                    Automated pre-screen — not a substitute for a human audit. Results should be reviewed by qualified security professionals before deployment.
                  </p>
                </div>

              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
