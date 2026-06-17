"use client";

import { useState, useRef } from "react";
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
  background: "rgba(5,5,10,0.38)",
  backdropFilter: "blur(48px) saturate(180%)",
  WebkitBackdropFilter: "blur(48px) saturate(180%)",
  border: "1px solid rgba(255,255,255,0.11)",
  boxShadow: [
    "0 32px 80px rgba(0,0,0,0.45)",
    "0 8px 24px rgba(0,0,0,0.3)",
    "inset 0 1px 0 rgba(255,255,255,0.1)",
    "inset 0 -1px 0 rgba(0,0,0,0.2)",
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

            {/* ── Zone 1: Header row — label + network segmented control ── */}
            <div className="flex items-center justify-between px-7 pt-6 pb-5">
              <span className="font-mono-plex text-[10px] uppercase tracking-[0.14em]" style={{ color: "var(--text-tertiary)" }}>
                {tab === "address" ? "Sui Package Address" : "Move Source"}
              </span>
              <div
                className="inline-flex rounded-full p-0.5 gap-0.5"
                style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.09)" }}
              >
                {(["testnet", "mainnet"] as Network[]).map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setNetwork(n)}
                    className="px-3 py-1 rounded-full font-mono-plex text-[10px] uppercase tracking-wide transition-all"
                    style={{
                      background: network === n ? "var(--brand-lavender)" : "transparent",
                      color:      network === n ? "var(--ink)"            : "var(--text-tertiary)",
                    }}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>

            {/* ── Divider ── */}
            <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }} />

            {/* ── Zone 2: Input area ── */}
            {tab === "address" ? (
              <div className="px-7 py-6">
                <input
                  type="text"
                  value={address}
                  onChange={(e) => handleAddressChange(e.target.value)}
                  onBlur={() => setAddressError(validateAddress(address))}
                  spellCheck={false}
                  className="w-full bg-transparent font-mono-plex text-[15px] text-white focus:outline-none leading-relaxed"
                  style={{ caretColor: "var(--brand-lavender)" }}
                />
                {/* underline — red on error */}
                <div
                  className="mt-5 h-px transition-colors"
                  style={{ background: addressError ? "rgba(255,92,92,0.55)" : "rgba(255,255,255,0.08)" }}
                />
                <div className="mt-2 flex items-center justify-between">
                  <span className="font-mono-plex text-[10px]" style={{ color: addressError ? "var(--severity-critical)" : "var(--text-tertiary)" }}>
                    {addressError ? `⚠ ${addressError}` : "0x + 64 hex characters"}
                  </span>
                  {address && !addressError && (
                    <span className="font-mono-plex text-[10px]" style={{ color: "var(--severity-safe)" }}>✓ valid</span>
                  )}
                </div>
              </div>
            ) : (
              <div className="px-7 py-5">
                <div className="flex items-center justify-between mb-3">
                  <span className="font-mono-plex text-[11px]" style={{ color: "var(--text-secondary)" }}>{fileName}</span>
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    className="font-sans-switzer text-[11px] px-3 py-1 rounded-full transition-colors flex items-center gap-1"
                    style={{ color: "var(--brand-lavender)", border: "1px solid rgba(184,180,255,0.25)" }}
                  >
                    <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                    </svg>
                    Upload .move
                  </button>
                  <input ref={fileRef} type="file" accept=".move" onChange={handleFilePick} className="hidden" />
                </div>
                <textarea
                  value={sourceText}
                  onChange={(e) => setSourceText(e.target.value)}
                  placeholder={`module example::contract {\n  // Paste your Move source here…\n}`}
                  rows={9}
                  spellCheck={false}
                  className="w-full bg-transparent font-mono-plex text-[13px] text-white focus:outline-none resize-y placeholder-[rgba(255,255,255,0.22)]"
                  style={{ lineHeight: 1.65, caretColor: "var(--brand-lavender)" }}
                />
              </div>
            )}

            {/* ── Divider ── */}
            <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }} />

            {/* ── Zone 3: Settings strip — on-chain + mainnet warning ── */}
            <div className="flex items-center gap-3 px-7 py-4">
              <label className="flex items-center gap-2.5 cursor-pointer flex-1 min-w-0">
                <input
                  type="checkbox"
                  checked={publishOnChain}
                  onChange={(e) => setPublishOnChain(e.target.checked)}
                  className="w-3.5 h-3.5 shrink-0 rounded accent-[var(--brand-lavender)]"
                />
                <span className="font-sans-switzer text-xs truncate" style={{ color: "var(--text-secondary)" }}>
                  <span className="text-white font-medium">Publish on-chain</span>
                  {" "}— write blob ID via MVR tx
                </span>
              </label>
              {network === "mainnet" && (
                <span className="font-mono-plex text-[10px] shrink-0" style={{ color: "var(--severity-medium)" }}>
                  ⚠ real SUI gas
                </span>
              )}
            </div>

            {/* ── API error ── */}
            {apiError && (
              <>
                <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }} />
                <div className="px-7 py-3 font-sans-switzer text-xs" style={{ color: "var(--severity-critical)" }}>
                  ⚠ {apiError}
                </div>
              </>
            )}

            {/* ── Divider ── */}
            <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }} />

            {/* ── Zone 4: CTA ── */}
            <div className="px-6 py-5">
              <button
                type="submit"
                disabled={submitting}
                className="w-full py-4 rounded-full font-sans-switzer font-semibold text-[15px] transition-all flex items-center justify-center gap-2.5"
                style={{
                  background: submitting ? "rgba(255,255,255,0.08)" : "var(--brand-lavender)",
                  color:      submitting ? "var(--text-tertiary)"   : "var(--ink)",
                  boxShadow: submitting ? "none" : "0 4px 24px rgba(184,180,255,0.25)",
                }}
              >
                {submitting ? (
                  <>
                    <svg className="w-4 h-4 animate-spin-slow" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                    </svg>
                    Starting audit…
                  </>
                ) : (
                  <>
                    <svg className="w-[17px] h-[17px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4" />
                    </svg>
                    Run Audit
                  </>
                )}
              </button>
            </div>

          </form>
        </div>

        {/* ── Stat tiles ──────────────────────────────────────────────────────── */}
        <div className="mt-8 grid grid-cols-2 sm:grid-cols-4 gap-3 w-full max-w-2xl text-center">
          {[
            { num: "65",      label: "Regex rules (13 sectors)", color: "var(--brand-lavender)" },
            { num: "10",      label: "OZ deviation checks",      color: "var(--brand-blue)" },
            { num: "5",       label: "Walrus storage epochs",    color: "var(--brand-blue)" },
            { num: "AES-256", label: "Seal encryption",          color: "var(--brand-lavender)" },
          ].map(({ num, label, color }) => (
            <div key={label} className="rounded-2xl p-4" style={GLASS}>
              <div className="font-display font-bold text-xl" style={{ color }}>{num}</div>
              <div className="font-sans-switzer text-xs mt-0.5" style={{ color: "var(--text-tertiary)" }}>{label}</div>
            </div>
          ))}
        </div>

        {/* ── Audit Gallery ────────────────────────────────────────────────────── */}
        <div className="mt-24 w-full max-w-4xl">
          <h2 className="font-display font-bold text-[32px] sm:text-[40px] leading-tight tracking-[-0.02em] text-white mb-2 text-center">
            Recent Public Audits
          </h2>
          <p className="font-sans-switzer text-sm text-center mb-8" style={{ color: "var(--text-tertiary)" }}>
            Pre-audited protocols — findings stored permanently on Walrus.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {(galleryData as GalleryEntry[]).map((entry) => (
              <div key={entry.id} className="rounded-2xl p-5 flex flex-col gap-3" style={GLASS}>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-sans-switzer text-sm font-semibold text-white truncate">
                      {entry.packageName}
                    </div>
                    <span
                      className="inline-block mt-1 font-mono-plex text-[11px] px-2.5 py-0.5 rounded-full"
                      style={
                        entry.network === "mainnet"
                          ? { background: "rgba(255,255,255,0.06)", color: "var(--text-secondary)", border: "1px solid rgba(255,255,255,0.12)" }
                          : { background: "rgba(77,162,255,0.12)",  color: "var(--brand-blue)",    border: "1px solid rgba(77,162,255,0.25)" }
                      }
                    >
                      {entry.network}
                    </span>
                  </div>
                  <RiskGradeBadge grade={entry.riskGrade} />
                </div>

                <div className="flex gap-2.5 font-mono-plex text-xs font-semibold">
                  <span style={{ color: "var(--severity-critical)" }}>{entry.severityCounts.critical}C</span>
                  <span style={{ color: "var(--severity-high)" }}>{entry.severityCounts.high}H</span>
                  <span style={{ color: "var(--severity-medium)" }}>{entry.severityCounts.medium}M</span>
                  <span style={{ color: "var(--severity-low)" }}>{entry.severityCounts.low}L</span>
                  <span className="ml-auto" style={{ color: "var(--text-tertiary)" }}>
                    {entry.totalFindings} findings
                  </span>
                </div>

                {entry.highlight && (
                  <p
                    className="font-sans-switzer text-xs rounded-xl px-3 py-2 leading-snug"
                    style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)", color: "var(--text-secondary)" }}
                  >
                    {entry.highlight}
                  </p>
                )}

                <div className="flex flex-wrap gap-1.5">
                  {entry.layersRun.map((l) => (
                    <span
                      key={l}
                      className="font-mono-plex text-[11px] px-2 py-0.5 rounded-full"
                      style={{ background: "rgba(255,255,255,0.06)", color: "var(--text-tertiary)" }}
                    >
                      {l}
                    </span>
                  ))}
                </div>

                <a
                  href={entry.walrusUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-auto font-sans-switzer text-xs underline underline-offset-2 break-all transition-colors"
                  style={{ color: "var(--brand-blue)" }}
                >
                  View on Walrus ↗
                </a>
              </div>
            ))}
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
