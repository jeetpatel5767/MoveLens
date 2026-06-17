"use client";

import { useState, useRef, Fragment } from "react";
import { useRouter } from "next/navigation";
import { Header } from "@/components/landing/layout/Header";
import { Footer } from "@/components/landing/footer/Footer";
import { AuroraBackground } from "@/components/landing/home/AuroraBackground";
import galleryData from "../gallery.json";

// ── Types ─────────────────────────────────────────────────────────────────────

interface GalleryEntry {
  id:             string;
  packageName:    string;
  packageId:      string;
  network:        string;
  riskGrade:      string;
  blobId:         string;
  walrusUrl:      string;
  description?:   string;
  highlight?:     string;
  severityCounts: { critical: number; high: number; medium: number; low: number };
  totalFindings:  number;
  auditedAt:      string;
  layersRun:      string[];
}

const ADDRESS_RE = /^0x[0-9a-fA-F]{64}$/;
type Tab = "address" | "source";
type Network = "testnet" | "mainnet";

// ── Risk grade badge ──────────────────────────────────────────────────────────

function RiskGradeBadge({ grade }: { grade: string }) {
  const styles: Record<string, React.CSSProperties> = {
    A: { color: "var(--severity-safe)",     background: "rgba(92,255,177,0.08)",  border: "1px solid rgba(92,255,177,0.25)" },
    B: { color: "#5ce0ff",                  background: "rgba(92,224,255,0.08)",  border: "1px solid rgba(92,224,255,0.25)" },
    C: { color: "var(--severity-medium)",   background: "rgba(255,193,92,0.08)",  border: "1px solid rgba(255,193,92,0.25)" },
    D: { color: "var(--severity-high)",     background: "rgba(255,139,92,0.08)",  border: "1px solid rgba(255,139,92,0.25)" },
    F: { color: "var(--severity-critical)", background: "rgba(255,92,92,0.08)",   border: "1px solid rgba(255,92,92,0.25)" },
  };
  return (
    <span
      className="inline-flex items-center justify-center w-10 h-10 rounded-xl text-lg font-extrabold shrink-0 font-display"
      style={styles[grade] ?? styles.C}
    >
      {grade}
    </span>
  );
}

// ── Shared glass style (gallery tiles) ───────────────────────────────────────

const GLASS: React.CSSProperties = {
  background: "rgba(255,255,255,0.04)",
  backdropFilter: "blur(20px)",
  WebkitBackdropFilter: "blur(20px)",
  border: "1px solid rgba(255,255,255,0.07)",
};

// ── Premium form card glass ───────────────────────────────────────────────────

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

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AppPage() {
  const router = useRouter();
  const [tab, setTab]                       = useState<Tab>("address");
  const [network, setNetwork]               = useState<Network>("testnet");
  const [address, setAddress]               = useState("");
  const [addressError, setAddressError]     = useState<string | null>(null);
  const [sourceText, setSourceText]         = useState("");
  const [fileName, setFileName]             = useState("contract.move");
  const fileRef                             = useRef<HTMLInputElement>(null);
  const [publishOnChain, setPublishOnChain] = useState(false);
  const [submitting, setSubmitting]         = useState(false);
  const [apiError, setApiError]             = useState<string | null>(null);

  function validateAddress(val: string): string | null {
    if (!val.trim()) return "Package address is required";
    if (!ADDRESS_RE.test(val.trim())) return "Must be a 0x-prefixed 64-character hex address";
    return null;
  }

  function handleAddressChange(val: string) {
    setAddress(val);
    if (addressError && ADDRESS_RE.test(val.trim())) setAddressError(null);
  }

  function handleFilePick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => setSourceText((ev.target?.result as string) ?? "");
    reader.readAsText(file);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setApiError(null);

    if (tab === "address") {
      const err = validateAddress(address);
      if (err) { setAddressError(err); return; }
    } else {
      if (!sourceText.trim()) { setApiError("Paste or upload at least one .move file"); return; }
    }

    setSubmitting(true);
    try {
      const body =
        tab === "address"
          ? { packageId: address.trim(), network, publishOnChain }
          : { source: { files: [{ name: fileName, content: sourceText }] }, network, publishOnChain };

      const res  = await fetch("/api/audit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json() as { auditId?: string; error?: string };

      if (!res.ok || !data.auditId) { setApiError(data.error ?? `Server error ${res.status}`); return; }
      router.push(`/audit/${data.auditId}`);
    } catch (err) {
      setApiError(err instanceof Error ? err.message : "Network error — is the dev server running?");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-black text-[var(--text-primary)] flex flex-col">
      <Header />

      {/* ── Hero ──────────────────────────────────────────────────────────────── */}
      <section className="relative w-full flex flex-col items-center justify-start pt-32 pb-6 px-6">
        <AuroraBackground />

        <div className="relative z-10 text-center max-w-4xl mx-auto">
          <h1 className="font-display font-bold text-[48px] sm:text-[64px] md:text-[80px] leading-[0.92] tracking-[-0.035em] text-white mb-5">
            Audit your contract.
          </h1>
          <p className="font-sans-switzer text-[16px] sm:text-[18px] leading-[1.6] max-w-xl mx-auto font-extralight" style={{ color: "var(--text-secondary)" }}>
            <span className="text-white font-light">4-layer security analysis</span> — 65 deterministic rules,
            OZ benchmarks, LanceDB semantic recall, DeepSeek-1.3B confirmation.
          </p>
        </div>
      </section>

      {/* ── Form section ──────────────────────────────────────────────────────── */}
      <section className="flex flex-col items-center px-6 pb-20">

        {/* Floating pill tab switcher */}
        <div className="flex justify-center pt-5 pb-4">
          <div
            className="inline-flex rounded-full p-1.5 gap-1 shadow-2xl"
            style={{
              background: "rgba(10,10,12,0.85)",
              backdropFilter: "blur(24px)",
              WebkitBackdropFilter: "blur(24px)",
              border: "1px solid rgba(255,255,255,0.1)",
            }}
          >
            {(["address", "source"] as Tab[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => { setTab(t); setApiError(null); }}
                className="px-6 py-2.5 rounded-full font-sans-switzer text-sm font-medium transition-all"
                style={{
                  background: tab === t ? "var(--brand-lavender)" : "transparent",
                  color:      tab === t ? "var(--ink)"            : "var(--text-secondary)",
                }}
              >
                {t === "address" ? "Package Address" : "Paste Source"}
              </button>
            ))}
          </div>
        </div>
        <div className="w-full max-w-2xl rounded-3xl relative overflow-hidden" style={FORM_GLASS}>
          {/* top-edge glass shimmer */}
          <div className="absolute inset-x-0 top-0 h-px" style={{ background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.18) 50%, transparent)" }} />

          <form onSubmit={handleSubmit}>

            {/* ── Zone 1: Header — logo + label left, network right ── */}
            <div className="flex items-center justify-between px-10 pt-10 pb-8">
              <div className="flex items-center gap-3.5">
                <img src="/Logo.png" alt="MoveLens" className="h-10 w-auto object-contain" />
                <span className="font-display font-semibold text-[22px] text-white leading-none">
                  {tab === "address" ? "Sui Package Address" : "Move Source"}
                </span>
              </div>
              <div
                className="inline-flex rounded-full p-1 gap-1"
                style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.09)" }}
              >
                {(["testnet", "mainnet"] as Network[]).map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setNetwork(n)}
                    className="px-5 py-2 rounded-full font-display text-[13px] font-medium transition-all"
                    style={{
                      background: network === n ? "var(--brand-lavender)" : "transparent",
                      color:      network === n ? "var(--ink)"            : "var(--text-tertiary)",
                    }}
                  >
                    {n.charAt(0).toUpperCase() + n.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            {/* ── Zone 2: Input area ── */}
            {tab === "address" ? (
              <div className="px-10 pb-10">
                <input
                  type="text"
                  value={address}
                  onChange={(e) => handleAddressChange(e.target.value)}
                  onBlur={() => setAddressError(validateAddress(address))}
                  spellCheck={false}
                  className="w-full bg-transparent font-mono-plex text-[19px] text-white focus:outline-none leading-relaxed"
                  style={{ caretColor: "var(--brand-lavender)" }}
                />
                <div
                  className="mt-6 h-px transition-colors"
                  style={{ background: addressError ? "rgba(255,92,92,0.55)" : "rgba(255,255,255,0.08)" }}
                />
                <div className="mt-3 flex items-center justify-between">
                  <span className="font-display text-[13px]" style={{ color: addressError ? "var(--severity-critical)" : "var(--text-tertiary)" }}>
                    {addressError ? `⚠ ${addressError}` : "0x · 64 hex chars"}
                  </span>
                  {address && !addressError && (
                    <span className="font-display text-[13px]" style={{ color: "var(--severity-safe)" }}>✓ valid</span>
                  )}
                </div>
              </div>
            ) : (
              <div className="px-10 pb-8">
                <div className="flex items-center justify-between mb-5">
                  <span className="font-display text-[15px]" style={{ color: "var(--text-secondary)" }}>{fileName}</span>
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    className="font-display text-[14px] px-5 py-2 rounded-full transition-colors flex items-center gap-1"
                    style={{ color: "var(--brand-lavender)", border: "1px solid rgba(184,180,255,0.25)" }}
                  >
                    ↑ Upload .move
                  </button>
                  <input ref={fileRef} type="file" accept=".move" onChange={handleFilePick} className="hidden" />
                </div>
                <textarea
                  value={sourceText}
                  onChange={(e) => setSourceText(e.target.value)}
                  placeholder={`module example::contract {\n  // Paste your Move source here…\n}`}
                  rows={10}
                  spellCheck={false}
                  className="w-full bg-transparent font-mono-plex text-[15px] text-white focus:outline-none resize-y placeholder-[rgba(255,255,255,0.22)]"
                  style={{ lineHeight: 1.75, caretColor: "var(--brand-lavender)" }}
                />
              </div>
            )}

            {/* ── Zone 3: Settings strip ── */}
            <div className="flex items-center gap-4 px-10 pb-7">
              <label className="flex items-center gap-3.5 cursor-pointer flex-1 min-w-0">
                <input
                  type="checkbox"
                  checked={publishOnChain}
                  onChange={(e) => setPublishOnChain(e.target.checked)}
                  className="w-4.5 h-4.5 shrink-0 rounded accent-[var(--brand-lavender)]"
                />
                <span className="font-display text-[15px] truncate" style={{ color: "var(--text-secondary)" }}>
                  <span className="text-white font-semibold">Publish on-chain</span>
                  {" "}— write blob ID via MVR tx
                </span>
              </label>
              {network === "mainnet" && (
                <span className="font-display text-[13px] shrink-0" style={{ color: "var(--severity-medium)" }}>
                  ⚠ real SUI gas
                </span>
              )}
            </div>

            {/* ── API error ── */}
            {apiError && (
              <div className="px-10 pb-5 font-display text-[14px]" style={{ color: "var(--severity-critical)" }}>
                ⚠ {apiError}
              </div>
            )}

            {/* ── Zone 4: CTA ── */}
            <div className="px-8 pb-8">
              <button
                type="submit"
                disabled={submitting}
                className="w-full py-3 rounded-full font-display font-bold text-[16px] tracking-wide transition-all flex items-center justify-center gap-2"
                style={{
                  background: submitting ? "rgba(255,255,255,0.08)" : "var(--brand-lavender)",
                  color:      submitting ? "var(--text-tertiary)"   : "var(--ink)",
                  boxShadow: "none",
                }}
              >
                {submitting ? (
                  <>
                    <svg className="w-3.5 h-3.5 animate-spin-slow" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                    </svg>
                    Starting audit…
                  </>
                ) : (
                  <>
                    Run Audit
                    <span className="text-[15px] leading-none">↗</span>
                  </>
                )}
              </button>
            </div>

          </form>
        </div>

        {/* ── Stat tiles ──────────────────────────────────────────────────────── */}
        <div className="mt-6 grid grid-cols-2 gap-4 w-full max-w-2xl">
          {([
            {
              num: "65",      numSize: "text-[64px]",
              label: "Regex rules",    sub: "across 13 sectors",
              color: "var(--brand-lavender)",
              icon: <><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></>,
            },
            {
              num: "10",      numSize: "text-[64px]",
              label: "OZ checks",      sub: "deviation benchmarks",
              color: "var(--brand-blue)",
              icon: <><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></>,
            },
            {
              num: "5",       numSize: "text-[64px]",
              label: "Walrus epochs",  sub: "storage guaranteed",
              color: "var(--brand-blue)",
              icon: <><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></>,
            },
            {
              num: "AES‑256", numSize: "text-[40px]",
              label: "Seal encrypt",   sub: "client-side keys",
              color: "var(--brand-lavender)",
              icon: <><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></>,
            },
          ] as const).map(({ num, numSize, label, sub, color, icon }) => (
            <div
              key={label}
              className="rounded-[24px] flex flex-row items-center gap-6 p-8"
              style={FORM_GLASS}
            >
              {/* Icon — left */}
              <svg className="w-[52px] h-[52px] shrink-0" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.25} strokeLinecap="round" strokeLinejoin="round">
                {icon}
              </svg>

              {/* Number + labels — right */}
              <div className="flex flex-col ml-4">
                <div className={`font-display font-bold text-white leading-none mb-2 ${numSize}`}>{num}</div>
                <div className="font-display text-[17px] font-semibold text-white/80 leading-tight">{label}</div>
                <div className="font-display text-[13px] mt-1.5" style={{ color: "var(--text-tertiary)" }}>{sub}</div>
              </div>
            </div>
          ))}
        </div>

        {/* ── Audit Gallery ────────────────────────────────────────────────────── */}
        <div className="mt-24 w-full max-w-4xl">
          <div className="text-center mb-10">
            <h2 className="font-display font-bold text-[40px] sm:text-[52px] leading-none tracking-[-0.03em] text-white mb-3">
              Recent Public Audits
            </h2>
            <p className="font-display text-[15px]" style={{ color: "var(--text-tertiary)" }}>
              Pre-audited protocols — findings stored permanently on Walrus.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
            {(galleryData as GalleryEntry[]).map((entry) => {
              const { critical, high, medium, low } = entry.severityCounts;
              const gradeColor: Record<string, string> = {
                A: "var(--severity-safe)", B: "#5ce0ff",
                C: "var(--severity-medium)", D: "var(--severity-high)",
                F: "var(--severity-critical)",
              };

              return (
                <div key={entry.id} className="rounded-xl overflow-hidden font-mono-plex" style={{ background: "#0a0a0c", border: "1px solid rgba(255,255,255,0.07)" }}>

                  {/* ── 2×2 header grid ── */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>

                    {/* Cell A: Identity */}
                    <div style={{ padding: "16px 18px 14px", borderRight: "1px solid rgba(255,255,255,0.06)", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                      <div className="text-[11px] leading-tight truncate" style={{ color: "rgba(255,255,255,0.75)" }}>{entry.packageName}</div>
                      <div className="text-[8px] uppercase tracking-[0.2em] mt-2" style={{ color: "rgba(255,255,255,0.2)" }}>{entry.network}</div>
                    </div>

                    {/* Cell B: Total findings */}
                    <div style={{ padding: "16px 18px 14px", borderBottom: "1px solid rgba(255,255,255,0.06)", display: "flex", flexDirection: "column", alignItems: "flex-end", justifyContent: "space-between" }}>
                      <div className="text-[8px] uppercase tracking-[0.2em]" style={{ color: "rgba(255,255,255,0.2)" }}>Findings</div>
                      <div style={{ display: "flex", alignItems: "baseline", gap: 3 }}>
                        <span className="font-display font-bold text-[40px] leading-none" style={{ color: "rgba(255,255,255,0.8)", letterSpacing: "-0.03em" }}>{entry.totalFindings}</span>
                        <span className="text-[11px] pb-1" style={{ color: "rgba(255,255,255,0.15)" }}>total</span>
                      </div>
                    </div>

                    {/* Cell C: Grade letter */}
                    <div style={{ padding: "10px 18px 18px", borderRight: "1px solid rgba(255,255,255,0.06)", display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
                      <div className="font-display font-extrabold leading-none" style={{ fontSize: 88, letterSpacing: "-0.04em", color: gradeColor[entry.riskGrade] ?? "white", lineHeight: 0.88 }}>
                        {entry.riskGrade}
                      </div>
                      <div className="text-[7.5px] uppercase tracking-[0.2em] mt-2" style={{ color: "rgba(255,255,255,0.2)" }}>Risk Grade</div>
                    </div>

                    {/* Cell D: Severity 2×2 breakdown */}
                    <div style={{ padding: "12px 18px 18px", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
                      <div className="text-[8px] uppercase tracking-[0.2em]" style={{ color: "rgba(255,255,255,0.2)" }}>By Severity</div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginTop: 10 }}>
                        {([
                          { count: critical, label: "Critical", color: "var(--severity-critical)" },
                          { count: high,     label: "High",     color: "var(--severity-high)" },
                          { count: medium,   label: "Medium",   color: "var(--severity-medium)" },
                          { count: low,      label: "Low",      color: low > 0 ? "var(--severity-low)" : "rgba(255,255,255,0.18)" },
                        ] as { count: number; label: string; color: string }[]).map(({ count, label, color }) => (
                          <div key={label} style={{ borderTop: `1px solid ${color}`, paddingTop: 6 }}>
                            <div className="font-display font-bold text-[22px] leading-none" style={{ color, letterSpacing: "-0.02em" }}>{count}</div>
                            <div className="text-[7px] uppercase tracking-[0.12em] mt-1" style={{ color: "rgba(255,255,255,0.22)" }}>{label}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* ── Severity stripe ── */}
                  <div style={{ height: 5, display: "flex" }}>
                    {critical > 0 && <div style={{ flex: critical, background: "var(--severity-critical)" }} />}
                    {high     > 0 && <div style={{ flex: high,     background: "var(--severity-high)" }} />}
                    {medium   > 0 && <div style={{ flex: medium,   background: "var(--severity-medium)" }} />}
                    {low      > 0 && <div style={{ flex: low,      background: "var(--severity-low)" }} />}
                  </div>

                  {/* ── Insight ── */}
                  <div style={{ padding: "15px 18px 14px", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                    <p className="text-[11.5px] italic leading-[1.8]" style={{ color: "rgba(255,255,255,0.35)" }}>
                      {entry.highlight ?? entry.description}
                    </p>
                  </div>

                  {/* ── Footer: layers + walrus ── */}
                  <div style={{ padding: "11px 18px", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      {entry.layersRun.map((l, i) => (
                        <Fragment key={l}>
                          {i > 0 && <span className="text-[9px]" style={{ color: "rgba(255,255,255,0.1)" }}>·</span>}
                          <span className="text-[8.5px] tracking-[0.06em] capitalize" style={{ color: "rgba(255,255,255,0.3)" }}>
                            {l.replace("layer", "Layer ")}
                          </span>
                        </Fragment>
                      ))}
                    </div>
                    <a href={entry.walrusUrl} target="_blank" rel="noopener noreferrer" className="text-[9px] tracking-[0.04em]" style={{ color: "var(--brand-blue)" }}>
                      Walrus ↗
                    </a>
                  </div>

                  {/* ── CTA ── */}
                  <div style={{ padding: "13px 18px" }}>
                    <a
                      href={entry.walrusUrl} target="_blank" rel="noopener noreferrer"
                      className="w-full text-[9px] uppercase tracking-[0.2em] flex items-center justify-center gap-3 transition-colors"
                      style={{ padding: "12px 18px", background: "transparent", border: "1px solid rgba(255,255,255,0.09)", color: "rgba(255,255,255,0.4)", display: "flex" }}
                    >
                      View Audit <span style={{ fontSize: 14, opacity: 0.4, letterSpacing: 0 }}>→</span>
                    </a>
                  </div>

                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── Watermark ─────────────────────────────────────────────────────────── */}
      <div
        className="py-3 px-6 text-center font-mono-plex text-[11px]"
        style={{ color: "var(--text-tertiary)" }}
      >
        Automated pre-screen — not a substitute for a human audit. · Sui Overflow 2026 · Walrus Track
      </div>

      {/* ── Footer ────────────────────────────────────────────────────────────── */}
      <Footer />
    </div>
  );
}
