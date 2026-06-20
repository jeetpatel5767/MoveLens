"use client";

import { useState } from "react";

// ── Static sample data (mirrors real AuditReport schema) ──────────────────────

const SAMPLE = {
  package: {
    packageId: "0xa9b0ffe2a99e44e2b5f8f67b2b4b38abe7c67b49d9b1e5e0d3f4a1c2e8b9c3f2",
    network: "mainnet",
    mvrName: "@cetus/amm",
    version: 3,
    moduleCount: 5,
    inputType: "address",
  },
  risk_grade: "D" as const,
  severity_counts: { critical: 0, high: 2, medium: 1, low: 1 },
  generated_at: "2025-06-18T14:22:04.000Z",
  layer4_used: true,
  memory_context_used: true,
  layer3_hits: 3,
  blobId: "4xK9mR2pTvXz7NqEbW3cYsAf1Ld6Gh8Ju0Ok5Pi",
  txDigest: "Cx4R…d9fE",
  sealed: true,
  watermark: "Automated pre-screen — not a substitute for a human audit.",
};

const FINDINGS = [
  {
    rule_id: "ML-INT-005",
    severity: "high" as const,
    confidence: 0.97,
    source: "layer1" as const,
    module: "v2_pool",
    line_start: 247,
    line_end: 249,
    description: "u64 * u64 result stored in u64 before division — intermediate overflow truncates high bits in swap output calculation.",
    recommendation: "Upcast to u128 or u256 before multiplication: `let r: u128 = (amount_in as u128) * (reserve_b as u128) / (reserve_a as u128);`",
    category: "integer_overflow",
    patch_before: `let amount_out = amount_in * pool.reserve_b
    / pool.reserve_a;`,
    patch_after: `let amount_out = (
    (amount_in as u128) * (pool.reserve_b as u128)
    / (pool.reserve_a as u128)
) as u64;`,
  },
  {
    rule_id: "ML-ACC-001",
    severity: "high" as const,
    confidence: 1.0,
    source: "layer1" as const,
    module: "v2_pool",
    line_start: 34,
    line_end: 34,
    description: "Public entry function `withdraw` has no capability parameter — callable by any transaction without an authorization guard.",
    recommendation: "Add `_: &AdminCap` parameter or assert `ctx.sender()` against a recorded owner before state mutations.",
    category: "access_control",
    patch_before: `public entry fun withdraw(
  pool: &mut Pool, amount: u64,
  ctx: &mut TxContext) {`,
    patch_after: `public entry fun withdraw(
  pool: &mut Pool, _: &AdminCap,
  amount: u64, ctx: &mut TxContext) {`,
  },
  {
    rule_id: "ML-UPG-004",
    severity: "medium" as const,
    confidence: 1.0,
    source: "layer1" as const,
    module: "v2_pool",
    line_start: 89,
    line_end: 89,
    description: "UpgradeCap held without a TimelockPolicy or multisig policy — a single compromised key can push a malicious upgrade.",
    recommendation: "Wrap UpgradeCap in `package::make_immutable` or a `TimelockPolicy` with at least 48-hour delay.",
    category: "unsafe_upgrade",
    patch_before: null,
    patch_after: null,
  },
  {
    rule_id: "ML-RAC-003-L4-001",
    severity: "low" as const,
    confidence: 0.71,
    source: "layer4" as const,
    module: "v2_pool",
    line_start: 156,
    line_end: 158,
    description: "Shared-object write contention on Pool struct — high-frequency trading may cause validator ordering delays and DoS-equivalent latency.",
    recommendation: "Minimize shared state; move per-user accounting to owned sub-objects with user-owned fields.",
    category: "race_condition",
    patch_before: null,
    patch_after: null,
  },
];

// ── Tokens (matching real audit page) ─────────────────────────────────────────

const BG      = "#0A0A0A";
const SURFACE = "#111111";
const BORDER  = "rgba(255,255,255,0.06)";
const BORDER5 = "rgba(255,255,255,0.05)";
const CARD: React.CSSProperties = { background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 16 };

type Severity = "critical" | "high" | "medium" | "low";
type FindingSource = "layer1" | "layer2" | "layer3" | "layer4";

const SEV: Record<Severity, string> = { critical:"#F87171", high:"#FB923C", medium:"#FBBF24", low:"#5cc9f5" };
const SEV_LABEL: Record<Severity, string> = { critical:"Critical", high:"High", medium:"Medium", low:"Low" };
const GRADE_COLOR: Record<string, string> = { A:"#4ade80", B:"#34d399", C:"#FBBF24", D:"#FB923C", F:"#F87171" };
const GRADE_SCORE: Record<string, number> = { A:95, B:80, C:60, D:40, F:20 };
const GRADE_LABEL: Record<string, string> = { A:"Clean", B:"Low Risk", C:"Medium Risk", D:"High Risk", F:"Critical Risk" };
const SOURCE_LABEL: Record<FindingSource, string> = {
  layer1:"Rules Engine (Layer 1)", layer2:"OZ Benchmarking (Layer 2)",
  layer3:"Semantic Memory (Layer 3)", layer4:"ML Analysis (Layer 4)",
};

const EYE: React.CSSProperties = {
  fontSize:10, fontWeight:600, letterSpacing:"0.16em",
  color:"rgba(255,255,255,0.22)", textTransform:"uppercase",
  marginBottom:16, fontFamily:"var(--font-display)",
};

// ── Risk Distribution bars ────────────────────────────────────────────────────

function RiskDistribution({ counts }: { counts: { critical:number; high:number; medium:number; low:number } }) {
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
              <div style={{ height:"100%", borderRadius:4, background:col, opacity:0.72, width:`${fill}%`, boxShadow:`0 0 10px ${col}55` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Category list ─────────────────────────────────────────────────────────────

function CategoryList() {
  const cats: { cat: string; count: number; topSev: Severity }[] = [
    { cat:"integer_overflow", count:1, topSev:"high" },
    { cat:"access_control",   count:1, topSev:"high" },
    { cat:"unsafe_upgrade",   count:1, topSev:"medium" },
    { cat:"race_condition",   count:1, topSev:"low" },
  ];
  const max = 1;
  return (
    <div style={{ ...CARD, overflow:"hidden" }}>
      {cats.map(({ cat, count, topSev }, i) => (
        <div key={cat} style={{ padding:"18px 28px", borderBottom: i < cats.length-1 ? `1px solid ${BORDER5}` : "none" }}>
          <div style={{ display:"flex", alignItems:"baseline", justifyContent:"space-between", marginBottom:10 }}>
            <span className="font-display" style={{ fontSize:14, fontWeight:500, color:"rgba(255,255,255,0.75)" }}>{cat.replace(/_/g," ")}</span>
            <span className="font-display" style={{ fontSize:12, color:"rgba(255,255,255,0.3)", marginLeft:16, whiteSpace:"nowrap" }}>{count} findings</span>
          </div>
          <div style={{ height:3, background:"rgba(255,255,255,0.05)", borderRadius:2, overflow:"hidden" }}>
            <div style={{ height:"100%", borderRadius:2, width:`${Math.round((count/max)*100)}%`, background:SEV[topSev], opacity:0.55 }} />
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Finding card ──────────────────────────────────────────────────────────────

interface FindingData {
  rule_id: string; severity: Severity; confidence: number; source: FindingSource;
  module: string; line_start: number; description: string; recommendation: string; category: string;
  patch_before?: string | null; patch_after?: string | null;
}

function FindingCard({ finding }: { finding: FindingData }) {
  const [open, setOpen] = useState(false);
  const col = SEV[finding.severity];
  const pct = Math.round(finding.confidence * 100);
  return (
    <div style={{ background:SURFACE, borderRadius:12, overflow:"hidden", border:`1px solid ${BORDER}`, borderLeft:`3px solid ${col}` }}>
      <button type="button" onClick={() => setOpen(v => !v)}
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
              <div className="font-display" style={{ fontSize:13, fontWeight:500, color:"rgba(255,255,255,0.55)" }}>{pct}%</div>
            </div>
            <div>
              <div className="font-display" style={{ fontSize:10, color:"rgba(255,255,255,0.2)", marginBottom:5, textTransform:"uppercase" as const, letterSpacing:"0.12em" }}>Analysis Layer</div>
              <div className="font-display" style={{ fontSize:13, fontWeight:500, color:"rgba(255,255,255,0.55)" }}>{SOURCE_LABEL[finding.source]}</div>
            </div>
          </div>
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

// ── Main export ───────────────────────────────────────────────────────────────

export function SampleReport() {
  const grade      = SAMPLE.risk_grade;
  const gradeColor = GRADE_COLOR[grade];
  const riskScore  = GRADE_SCORE[grade];
  const { critical, high, medium, low } = SAMPLE.severity_counts;
  const total = critical + high + medium + low;
  const avgConf = Math.round(FINDINGS.reduce((s, f) => s + f.confidence, 0) / FINDINGS.length * 100);
  const byLayer = { layer1: 2, layer2: 0, layer3: 0, layer4: 1 };

  return (
    <section id="demo" className="relative w-full px-6 py-20 sm:py-28" style={{ background: BG }}>
      {/* Section heading */}
      <div className="max-w-[1100px] mx-auto text-center flex flex-col items-center mb-14 sm:mb-20">
        <h2 className="font-display font-bold text-[40px] sm:text-[64px] md:text-[78px] leading-[0.98] tracking-[-0.03em] text-white">
          No exploit
          <br />
          survives the light.
        </h2>
        <p className="mt-5 text-[16px] sm:text-[18px] leading-[1.6] text-[var(--text-secondary)] max-w-xl font-sans-switzer font-extralight">
          Every audit surfaces structured findings — severity-ranked, code-pinned,
          encrypted, and stored permanently on Walrus.
        </p>
      </div>

      {/* Report frame */}
      <div style={{ maxWidth:1080, margin:"0 auto" }}>

        {/* ── HERO ── */}
        <div style={{
          padding:"52px 56px 48px",
          display:"flex", alignItems:"flex-start", justifyContent:"space-between", gap:48,
          borderBottom:`1px solid ${BORDER}`,
          background: SURFACE, borderRadius:"16px 16px 0 0", border:`1px solid ${BORDER}`,
        }}>
          <div style={{ flex:1, minWidth:0 }}>
            <div className="font-display" style={EYE}>Security Report · Sample</div>
            <div className="font-display" style={{ fontSize:36, fontWeight:700, color:"#fff", letterSpacing:"-0.03em", lineHeight:1.08, marginBottom:8 }}>
              Move Package Audit
            </div>
            <div className="font-display" style={{ fontSize:20, fontWeight:400, color:"rgba(255,255,255,0.45)", letterSpacing:"-0.015em", marginBottom:32 }}>
              {SAMPLE.package.mvrName} · v2_pool
            </div>

            <div style={{ display:"inline-flex", alignItems:"center", gap:10, padding:"10px 16px", background:"rgba(255,255,255,0.04)", border:`1px solid ${BORDER}`, borderRadius:10, marginBottom:32 }}>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ flexShrink:0 }}>
                <rect x="1.5" y="1.5" width="9" height="9" rx="1.5" stroke="rgba(255,255,255,0.2)" strokeWidth="1.2" fill="none"/>
                <path d="M4 6h4" stroke="rgba(255,255,255,0.2)" strokeWidth="1.2" strokeLinecap="round"/>
              </svg>
              <span className="font-mono-plex" style={{ fontSize:12, color:"rgba(255,255,255,0.32)", letterSpacing:"0.04em" }}>
                0xa9b0ffe2…c3f2
              </span>
            </div>

            <div style={{ display:"flex", gap:48, flexWrap:"wrap" }}>
              {[
                { label:"Modules",   val:"5" },
                { label:"Version",   val:"v3" },
                { label:"Network",   val:"Mainnet" },
                { label:"Generated", val:"Jun 18, 2025" },
              ].map(({ label, val }) => (
                <div key={label}>
                  <div className="font-display" style={{ fontSize:11, color:"rgba(255,255,255,0.25)", marginBottom:6, letterSpacing:"0.04em" }}>{label}</div>
                  <div className="font-display" style={{ fontSize:15, fontWeight:500, color:"rgba(255,255,255,0.75)" }}>{val}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Score */}
          <div style={{ flexShrink:0, textAlign:"right" }}>
            <div className="font-display" style={{ fontSize:120, fontWeight:700, lineHeight:1, letterSpacing:"-0.055em", color:gradeColor }}>
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

        {/* ── MAIN GRID ── */}
        <div style={{
          display:"grid", gridTemplateColumns:"1fr 280px", gap:0,
          background: BG, border:`1px solid ${BORDER}`, borderTop:"none", borderRadius:"0 0 16px 16px",
        }}>

          {/* LEFT */}
          <div style={{ padding:"48px 40px 64px", display:"flex", flexDirection:"column", gap:48, borderRight:`1px solid ${BORDER}`, minWidth:0 }}>

            {/* Executive Summary */}
            <div>
              <div className="font-display" style={EYE}>Executive Summary</div>
              <div style={{ ...CARD, padding:"28px 32px", display:"grid", gridTemplateColumns:"repeat(5,1fr)" }}>
                {[
                  { label:"Risk Score", val:String(riskScore), col:gradeColor },
                  { label:"Findings",   val:String(total),     col:"#fff" },
                  { label:"Critical",   val:String(critical),  col:critical>0?"#F87171":"#fff" },
                  { label:"Modules",    val:"5",               col:"#fff" },
                  { label:"Confidence", val:`${avgConf}%`,     col:"#fff" },
                ].map(({ label, val, col }, i, arr) => (
                  <div key={label} style={{
                    paddingRight: i < arr.length-1 ? 24 : 0,
                    paddingLeft:  i > 0 ? 24 : 0,
                    borderRight:  i < arr.length-1 ? `1px solid ${BORDER}` : "none",
                  }}>
                    <div className="font-display" style={{ fontSize:32, fontWeight:700, letterSpacing:"-0.035em", lineHeight:1, marginBottom:9, color:col }}>{val}</div>
                    <div className="font-display" style={{ fontSize:10, color:"rgba(255,255,255,0.28)", letterSpacing:"0.1em", textTransform:"uppercase" as const }}>{label}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Severity Overview */}
            <div>
              <div className="font-display" style={EYE}>Severity Overview</div>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:10 }}>
                {(["critical","high","medium","low"] as Severity[]).map(sev => {
                  const cnt   = SAMPLE.severity_counts[sev];
                  const col   = SEV[sev];
                  const pct   = total > 0 ? ((cnt/total)*100).toFixed(1) : "0.0";
                  const worst = sev === "critical" && cnt > 0;
                  return (
                    <div key={sev} style={{ background:SURFACE, border:`1px solid ${worst ? col+"24" : BORDER}`, borderRadius:14, padding:"20px 18px" }}>
                      <div style={{ display:"flex", alignItems:"center", gap:7, marginBottom:18 }}>
                        <div style={{ width:7, height:7, borderRadius:"50%", background:col, flexShrink:0 }} />
                        <span className="font-display" style={{ fontSize:10, fontWeight:600, letterSpacing:"0.1em", color:worst?col:"rgba(255,255,255,0.4)", textTransform:"uppercase" as const }}>
                          {SEV_LABEL[sev]}
                        </span>
                      </div>
                      <div className="font-display" style={{ fontSize:38, fontWeight:700, color:"#fff", letterSpacing:"-0.04em", lineHeight:1, marginBottom:6 }}>{cnt}</div>
                      <div className="font-display" style={{ fontSize:11, color:"rgba(255,255,255,0.28)" }}>{pct}% of total</div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Risk Distribution */}
            <div>
              <div className="font-display" style={EYE}>Risk Distribution</div>
              <div style={{ ...CARD, padding:"28px 32px" }}>
                <RiskDistribution counts={SAMPLE.severity_counts} />
              </div>
            </div>

            {/* Category Analysis */}
            <div>
              <div className="font-display" style={EYE}>Category Analysis</div>
              <CategoryList />
            </div>

            {/* Findings */}
            <div>
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:16 }}>
                <div className="font-display" style={{ ...EYE, marginBottom:0 }}>Findings</div>
                <div className="font-display" style={{ fontSize:12, color:"rgba(255,255,255,0.25)" }}>{total} total</div>
              </div>
              <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                {FINDINGS.map((f, i) => <FindingCard key={`${f.rule_id}-${i}`} finding={f} />)}
              </div>
            </div>

            <a href="/app" className="font-display" style={{ fontSize:13, color:"#8B8DFF", textDecoration:"none", opacity:0.7, display:"block" }}>
              ← Run your own audit
            </a>
          </div>

          {/* SIDEBAR */}
          <div style={{ padding:"48px 24px 64px", display:"flex", flexDirection:"column", gap:14 }}>

            {/* Audit Snapshot */}
            <div style={{ ...CARD, padding:"22px 24px" }}>
              <div className="font-display" style={{ fontSize:10, fontWeight:600, letterSpacing:"0.14em", color:"rgba(255,255,255,0.22)", textTransform:"uppercase" as const, marginBottom:18 }}>
                Audit Snapshot
              </div>
              {[
                { label:"Risk Score",     right: <span className="font-display" style={{ fontSize:13, fontWeight:600, color:gradeColor }}>{riskScore} / 100</span> },
                { label:"Grade",          right: <span className="font-display" style={{ fontSize:14, fontWeight:700, color:gradeColor, letterSpacing:"-0.01em" }}>{grade}</span> },
                { label:"Total Findings", right: <span className="font-display" style={{ fontSize:13, fontWeight:600, color:"#fff" }}>{total}</span> },
                { label:"Status",         right: <div style={{ display:"flex", alignItems:"center", gap:6 }}><div style={{ width:5, height:5, borderRadius:"50%", background:"#4ade80" }} /><span className="font-display" style={{ fontSize:13, fontWeight:500, color:"rgba(255,255,255,0.55)" }}>Completed</span></div> },
              ].map(({ label, right }, i, arr) => (
                <div key={label} style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"11px 0", borderBottom:i<arr.length-1?`1px solid ${BORDER5}`:"none" }}>
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
                  <span className="font-mono-plex" style={{ fontSize:11, color:"rgba(255,255,255,0.47)" }}>4xK9mR2p…NqE7</span>
                </div>
                <div style={{ padding:"11px 0", borderBottom:`1px solid ${BORDER5}` }}>
                  <div className="font-display" style={{ fontSize:11, color:"rgba(255,255,255,0.22)", marginBottom:5, letterSpacing:"0.04em" }}>Transaction</div>
                  <span className="font-mono-plex" style={{ fontSize:11, color:"#8B8DFF" }}>Cx4R…d9fE</span>
                </div>
                <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"11px 0" }}>
                  <div className="font-display" style={{ fontSize:11, color:"rgba(255,255,255,0.22)", letterSpacing:"0.04em" }}>Seal Status</div>
                  <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                    <div style={{ width:5, height:5, borderRadius:"50%", background:"#4ade80" }} />
                    <span className="font-display" style={{ fontSize:11, color:"rgba(255,255,255,0.47)" }}>Verified</span>
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
                { name:"Semantic Memory", layer:"Layer 3", count:byLayer.layer3, on:SAMPLE.memory_context_used },
                { name:"ML Analysis",     layer:"Layer 4", count:1, on:SAMPLE.layer4_used },
              ].map(({ name, layer, count, on }, i, arr) => (
                <div key={layer} style={{ padding:"12px 0", borderBottom:i<arr.length-1?`1px solid ${BORDER5}`:"none", opacity:on?1:0.35 }}>
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
              <p className="font-sans-switzer" style={{ fontSize:11, lineHeight:1.72, color:"rgba(255,255,255,0.22)", margin:0 }}>
                {SAMPLE.watermark}
              </p>
            </div>

          </div>
        </div>

        {/* CTA */}
        <div className="mt-10 flex justify-center">
          <a href="/app" className="bg-[var(--brand-lavender)] hover:bg-[var(--brand-lavender-hover)] text-[var(--ink)] px-8 py-3.5 rounded-full text-sm font-semibold tracking-wide transition-all flex items-center gap-2 shadow-lg">
            Run your own audit <span className="opacity-80 text-xs">↗</span>
          </a>
        </div>
      </div>
    </section>
  );
}
