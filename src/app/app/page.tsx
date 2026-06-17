"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { Header } from "@/components/landing/layout/Header";
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

const CETUS_PACKAGE_ID = "0xa9b0ffe2f8e713a66ad1aa361cf1984526a5048c6de786b4dd292f3eed204b92";

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

// ── Cetus hero card ───────────────────────────────────────────────────────────

function CetusHero({ entry, onRunLive }: { entry: GalleryEntry; onRunLive: () => void }) {
  return (
    <div className="w-full max-w-2xl mb-8">
      <div
        className="rounded-2xl p-5"
        style={{
          background: "rgba(255,92,92,0.04)",
          border: "1px solid rgba(255,92,92,0.18)",
          backdropFilter: "blur(20px)",
        }}
      >
        <div className="flex items-center gap-3 mb-3">
          <RiskGradeBadge grade="F" />
          <div>
            <p className="font-mono-plex text-xs" style={{ color: "var(--text-tertiary)" }}>
              @cetus/clmm · mainnet · May 22, 2025
            </p>
            <p className="text-xs font-medium" style={{ color: "var(--severity-critical)" }}>
              34 critical · 66 high · 129 findings total
            </p>
          </div>
        </div>

        <h2 className="font-display font-bold text-[22px] leading-tight text-white mb-1">
          $223,000,000 lost to one bit-shift overflow.
        </h2>
        <p className="text-sm mb-1 font-sans-switzer" style={{ color: "var(--text-secondary)" }}>
          ML-INT-001 fires on the real, deployed Cetus AMM contract with confidence 1.0.
          This deterministic rule runs in under 5 seconds and costs nothing.
        </p>
        <p className="text-xs mb-4 font-sans-switzer" style={{ color: "var(--severity-high)", opacity: 0.75 }}>
          The 34 critical findings are all instances of{" "}
          <code className="font-mono-plex">integer_mate::checked_shlw</code> called across
          deposit, withdraw, and swap functions — the exact pattern that was exploited.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
          <div
            className="rounded-xl p-3"
            style={{ background: "rgba(255,92,92,0.08)", border: "1px solid rgba(255,92,92,0.2)" }}
          >
            <p className="font-mono-plex text-xs font-semibold mb-2 uppercase tracking-wide" style={{ color: "var(--severity-critical)" }}>
              Vulnerable (deployed)
            </p>
            <pre className="font-mono-plex text-xs overflow-x-auto leading-relaxed" style={{ color: "#ffc4c4" }}>
              <code>{`let mask = 0xffffffffffffffff\n      << 192;\nif (n > mask) { (0, true) }\nelse { (n << 64, false) }`}</code>
            </pre>
          </div>
          <div
            className="rounded-xl p-3"
            style={{ background: "rgba(92,255,177,0.06)", border: "1px solid rgba(92,255,177,0.2)" }}
          >
            <p className="font-mono-plex text-xs font-semibold mb-2 uppercase tracking-wide" style={{ color: "var(--severity-safe)" }}>
              OZ safe pattern
            </p>
            <pre className="font-mono-plex text-xs overflow-x-auto leading-relaxed" style={{ color: "#c4ffe4" }}>
              <code>{`// Checked shift — aborts on overflow\n// instead of silently truncating\nu256::checked_shl(n, 64)\n  // returns None on overflow`}</code>
            </pre>
          </div>
        </div>

        <div className="flex flex-wrap gap-4">
          <a
            href={entry.walrusUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs underline underline-offset-2 transition-colors font-sans-switzer"
            style={{ color: "var(--brand-blue)" }}
          >
            View permanent audit on Walrus ↗
          </a>
          <button
            type="button"
            onClick={onRunLive}
            className="text-xs underline underline-offset-2 transition-colors font-sans-switzer"
            style={{ color: "var(--text-secondary)" }}
          >
            Re-run live →
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

const GLASS: React.CSSProperties = {
  background: "rgba(255,255,255,0.04)",
  backdropFilter: "blur(20px)",
  WebkitBackdropFilter: "blur(20px)",
  border: "1px solid rgba(255,255,255,0.07)",
};

export default function AppPage() {
  const router = useRouter();
  const [tab, setTab]           = useState<Tab>("address");
  const [network, setNetwork]   = useState<Network>("testnet");
  const [address, setAddress]   = useState("");
  const [addressError, setAddressError] = useState<string | null>(null);
  const [sourceText, setSourceText]     = useState("");
  const [fileName, setFileName]         = useState("contract.move");
  const fileRef = useRef<HTMLInputElement>(null);
  const [publishOnChain, setPublishOnChain] = useState(false);
  const [submitting, setSubmitting]     = useState(false);
  const [apiError, setApiError]         = useState<string | null>(null);

  function runLiveCetusAudit() {
    setTab("address");
    setAddress(CETUS_PACKAGE_ID);
    setAddressError(null);
    setApiError(null);
    setNetwork("mainnet");
  }

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

      {/* ── Main content ───────────────────────────────────────────────────── */}
      <section className="flex-1 flex flex-col items-center justify-center px-6 pt-36 pb-20">

        {/* Page title */}
        <div className="text-center mb-10">
          <h1 className="font-display font-bold text-[56px] sm:text-[72px] leading-[0.95] tracking-[-0.03em] text-white mb-4">
            Audit your contract.
          </h1>
          <p className="font-sans-switzer text-[17px] leading-relaxed max-w-lg mx-auto" style={{ color: "var(--text-secondary)" }}>
            4-layer security analysis — 65 deterministic rules, OZ benchmarks,
            LanceDB semantic recall, DeepSeek-1.3B confirmation.
          </p>
        </div>

        {/* ── Cetus hero ───────────────────────────────────────────────────── */}
        <CetusHero
          entry={(galleryData as GalleryEntry[])[0]}
          onRunLive={runLiveCetusAudit}
        />

        {/* ── Input card ───────────────────────────────────────────────────── */}
        <div className="w-full max-w-2xl rounded-2xl overflow-hidden shadow-2xl" style={GLASS}>

          {/* Tabs */}
          <div style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }} className="flex">
            {(["address", "source"] as Tab[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => { setTab(t); setApiError(null); }}
                className="flex-1 py-3.5 text-sm font-medium font-sans-switzer transition-colors"
                style={{
                  color: tab === t ? "var(--brand-lavender)" : "var(--text-tertiary)",
                  borderBottom: tab === t ? "2px solid var(--brand-lavender)" : "2px solid transparent",
                  background: tab === t ? "rgba(184,180,255,0.05)" : "transparent",
                }}
              >
                {t === "address" ? "📦 Package Address" : "📄 Paste Source"}
              </button>
            ))}
          </div>

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
                  Single .move file · max 1 MB · must contain a <code className="font-mono-plex" style={{ color: "var(--text-secondary)" }}>module</code> declaration
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
                      color: network === n ? "var(--ink)" : "var(--text-tertiary)",
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
            <label className="flex items-start gap-3 cursor-pointer group">
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
                color: submitting ? "var(--text-tertiary)" : "var(--ink)",
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

        {/* ── Stat tiles ───────────────────────────────────────────────────── */}
        <div className="mt-8 grid grid-cols-2 sm:grid-cols-4 gap-3 w-full max-w-2xl text-center">
          {[
            { num: "65",      label: "Regex rules (13 sectors)", color: "var(--brand-lavender)" },
            { num: "10",      label: "OZ deviation checks",      color: "var(--brand-blue)" },
            { num: "5",       label: "Walrus storage epochs",    color: "var(--brand-blue)" },
            { num: "AES-256", label: "Seal encryption",          color: "var(--severity-safe)" },
          ].map(({ num, label, color }) => (
            <div key={label} className="rounded-2xl p-4" style={GLASS}>
              <div className="font-display font-bold text-xl" style={{ color }}>{num}</div>
              <div className="font-sans-switzer text-xs mt-0.5" style={{ color: "var(--text-tertiary)" }}>{label}</div>
            </div>
          ))}
        </div>

        {/* ── Audit Gallery ────────────────────────────────────────────────── */}
        <div className="mt-20 w-full max-w-4xl">
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
                          ? { background: "rgba(255,193,92,0.12)", color: "var(--severity-medium)", border: "1px solid rgba(255,193,92,0.25)" }
                          : { background: "rgba(77,162,255,0.12)", color: "var(--brand-blue)",     border: "1px solid rgba(77,162,255,0.25)" }
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
                    style={{ background: "rgba(255,193,92,0.08)", border: "1px solid rgba(255,193,92,0.2)", color: "var(--severity-medium)" }}
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

      {/* ── Footer ───────────────────────────────────────────────────────────── */}
      <footer
        className="py-4 px-6 text-center font-sans-switzer text-xs"
        style={{ borderTop: "1px solid rgba(255,255,255,0.06)", color: "var(--text-tertiary)" }}
      >
        Automated pre-screen — not a substitute for a human audit. · Sui Overflow 2026 · Walrus Track
      </footer>
    </div>
  );
}
