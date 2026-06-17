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

// ── Shared glass style ────────────────────────────────────────────────────────

const GLASS: React.CSSProperties = {
  background: "rgba(255,255,255,0.04)",
  backdropFilter: "blur(20px)",
  WebkitBackdropFilter: "blur(20px)",
  border: "1px solid rgba(255,255,255,0.07)",
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

  const inputBase: React.CSSProperties = {
    background: "var(--surface-nested)",
    border: "1px solid rgba(255,255,255,0.09)",
    color: "var(--text-primary)",
    borderRadius: 10,
  };

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
        <div className="w-full max-w-2xl rounded-2xl shadow-2xl" style={GLASS}>
          <form onSubmit={handleSubmit} className="p-6 space-y-5">

            {tab === "address" && (
              <div>
                <label className="block font-sans-switzer text-xs font-medium mb-1.5" style={{ color: "var(--text-secondary)" }}>
                  Sui Package Address
                </label>
                <input
                  type="text"
                  value={address}
                  onChange={(e) => handleAddressChange(e.target.value)}
                  onBlur={() => setAddressError(validateAddress(address))}
                  placeholder="0x0000000000000000000000000000000000000000000000000000000000000002"
                  spellCheck={false}
                  className="w-full px-4 py-3 font-mono-plex text-sm placeholder-[var(--text-tertiary)] focus:outline-none transition-all"
                  style={{
                    ...inputBase,
                    boxShadow: addressError ? "0 0 0 2px rgba(255,92,92,0.4)" : undefined,
                    border: addressError ? "1px solid rgba(255,92,92,0.5)" : "1px solid rgba(255,255,255,0.09)",
                  }}
                />
                {addressError && (
                  <p className="mt-1.5 font-sans-switzer text-xs flex items-center gap-1" style={{ color: "var(--severity-critical)" }}>
                    ⚠ {addressError}
                  </p>
                )}
              </div>
            )}

            {tab === "source" && (
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <label className="font-sans-switzer text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
                    File name
                  </label>
                  <input
                    type="text"
                    value={fileName}
                    onChange={(e) => setFileName(e.target.value)}
                    className="flex-1 px-3 py-1.5 font-mono-plex text-xs focus:outline-none transition-all"
                    style={inputBase}
                  />
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    className="font-sans-switzer text-xs px-3 py-1.5 rounded-full transition-colors"
                    style={{ color: "var(--brand-lavender)", border: "1px solid rgba(184,180,255,0.3)" }}
                  >
                    Upload file
                  </button>
                  <input ref={fileRef} type="file" accept=".move" onChange={handleFilePick} className="hidden" />
                </div>
                <textarea
                  value={sourceText}
                  onChange={(e) => setSourceText(e.target.value)}
                  placeholder={`module example::contract {\n  // Paste your Move source here…\n}`}
                  rows={10}
                  spellCheck={false}
                  className="w-full px-4 py-3 font-mono-plex text-sm focus:outline-none resize-y transition-all"
                  style={{ ...inputBase, lineHeight: 1.6 }}
                />
                <p className="font-sans-switzer text-xs" style={{ color: "var(--text-tertiary)" }}>
                  Single .move file · max 1 MB · must contain a{" "}
                  <code className="font-mono-plex" style={{ color: "var(--text-secondary)" }}>module</code> declaration
                </p>
              </div>
            )}

            {/* Network selector */}
            <div className="flex items-center gap-3">
              <label className="font-sans-switzer text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
                Network
              </label>
              <div className="flex rounded-full overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.09)" }}>
                {(["testnet", "mainnet"] as Network[]).map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setNetwork(n)}
                    className="px-4 py-1.5 font-sans-switzer text-xs font-medium transition-colors"
                    style={{
                      background: network === n ? "var(--brand-lavender)" : "transparent",
                      color:      network === n ? "var(--ink)"            : "var(--text-tertiary)",
                    }}
                  >
                    {n}
                  </button>
                ))}
              </div>
              {network === "mainnet" && (
                <span className="font-sans-switzer text-xs" style={{ color: "var(--severity-medium)" }}>
                  ⚠ mainnet — uses real SUI gas
                </span>
              )}
            </div>

            {/* Privacy consent */}
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={publishOnChain}
                onChange={(e) => setPublishOnChain(e.target.checked)}
                className="mt-0.5 w-4 h-4 shrink-0 accent-[var(--brand-lavender)]"
              />
              <span className="font-sans-switzer text-xs leading-relaxed" style={{ color: "var(--text-tertiary)" }}>
                <span className="font-medium" style={{ color: "var(--text-secondary)" }}>Publish audit on-chain</span> — write the
                Walrus blob ID to the MoveLens PackageInfo object via an MVR transaction.
                Your package address will be included in the on-chain record.
                Leave unchecked to keep the audit report off-chain only.
              </span>
            </label>

            {/* API error */}
            {apiError && (
              <div
                className="rounded-xl px-4 py-3 font-sans-switzer text-sm"
                style={{ background: "rgba(255,92,92,0.08)", border: "1px solid rgba(255,92,92,0.25)", color: "var(--severity-critical)" }}
              >
                {apiError}
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={submitting}
              className="w-full py-3.5 rounded-full font-sans-switzer font-semibold text-sm transition-all flex items-center justify-center gap-2 shadow-lg"
              style={{
                background: submitting ? "rgba(255,255,255,0.08)" : "var(--brand-lavender)",
                color:      submitting ? "var(--text-tertiary)"   : "var(--ink)",
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
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4" />
                  </svg>
                  Run Audit
                </>
              )}
            </button>
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
