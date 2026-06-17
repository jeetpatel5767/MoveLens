"use client";

// Landing page — hero + audit input (package address OR source upload)
// F20: client-side address validation, network selector, POST /api/audit → /audit/[id]

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
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

// ── Constants ─────────────────────────────────────────────────────────────────

const ADDRESS_RE = /^0x[0-9a-fA-F]{64}$/;

type Tab = "address" | "source";
type Network = "testnet" | "mainnet";

// ── Sub-components ────────────────────────────────────────────────────────────

function ShieldIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4" />
    </svg>
  );
}

function LayerBadge({ label, color }: { label: string; color: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${color}`}
    >
      {label}
    </span>
  );
}

const CETUS_PACKAGE_ID = "0xa9b0ffe2f8e713a66ad1aa361cf1984526a5048c6de786b4dd292f3eed204b92";

function RiskGradeBadge({ grade }: { grade: string }) {
  const colors: Record<string, string> = {
    A: "bg-green-950/60 border-green-700 text-green-400",
    B: "bg-teal-950/60 border-teal-700 text-teal-400",
    C: "bg-yellow-950/60 border-yellow-700 text-yellow-400",
    D: "bg-orange-950/60 border-orange-700 text-orange-400",
    F: "bg-red-950/60 border-red-700 text-red-400",
  };
  return (
    <span
      className={`inline-flex items-center justify-center w-10 h-10 rounded-xl text-lg font-extrabold border shrink-0 ${
        colors[grade] ?? colors.C
      }`}
    >
      {grade}
    </span>
  );
}

interface CetusHeroProps {
  entry: GalleryEntry;
  onRunLive: () => void;
}

function CetusHero({ entry, onRunLive }: CetusHeroProps) {
  return (
    <div className="w-full max-w-2xl mb-8">
      <div className="border border-red-800/60 rounded-2xl p-5 bg-gradient-to-br from-red-950/60 to-orange-950/40">
        {/* Header */}
        <div className="flex items-center gap-3 mb-3">
          <RiskGradeBadge grade="F" />
          <div>
            <p className="text-xs font-mono text-gray-400">@cetus/clmm · mainnet · May 22, 2025</p>
            <p className="text-xs text-red-400/80 font-medium">34 critical · 66 high · 129 findings total</p>
          </div>
        </div>

        <h2 className="text-xl font-bold text-white mb-1">
          $223,000,000 lost to one bit-shift overflow.
        </h2>
        <p className="text-sm text-gray-400 mb-1">
          ML-INT-001 fires on the real, deployed Cetus AMM contract with confidence 1.0.
          This deterministic rule runs in under 5 seconds and costs nothing.
        </p>
        <p className="text-xs text-orange-400/70 mb-4">
          The 34 critical findings are all instances of{" "}
          <code className="font-mono">integer_mate::checked_shlw</code> called across
          deposit, withdraw, and swap functions — the exact pattern that was exploited.
        </p>

        {/* Side-by-side code panels */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
          <div className="bg-red-950/50 border border-red-800/40 rounded-lg p-3">
            <p className="text-xs font-semibold text-red-400 mb-2 uppercase tracking-wide">
              Vulnerable (deployed)
            </p>
            <pre className="text-xs text-red-200 overflow-x-auto leading-relaxed"><code>{`let mask = 0xffffffffffffffff
      << 192;
if (n > mask) { (0, true) }
else { (n << 64, false) }`}</code></pre>
          </div>
          <div className="bg-green-950/50 border border-green-800/40 rounded-lg p-3">
            <p className="text-xs font-semibold text-green-400 mb-2 uppercase tracking-wide">
              OZ safe pattern
            </p>
            <pre className="text-xs text-green-200 overflow-x-auto leading-relaxed"><code>{`// Checked shift — aborts on overflow
// instead of silently truncating
u256::checked_shl(n, 64)
  // returns None on overflow`}</code></pre>
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-wrap gap-3">
          <a
            href={entry.walrusUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-cyan-400 hover:text-cyan-300 underline underline-offset-2 transition-colors"
          >
            View permanent audit on Walrus ↗
          </a>
          <button
            type="button"
            onClick={onRunLive}
            className="text-xs text-gray-300 hover:text-white underline underline-offset-2 transition-colors"
          >
            Re-run live →
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function HomePage() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("address");
  const [network, setNetwork] = useState<Network>("testnet");

  // Package address tab state
  const [address, setAddress] = useState("");
  const [addressError, setAddressError] = useState<string | null>(null);

  // Source tab state
  const [sourceText, setSourceText] = useState("");
  const [fileName, setFileName] = useState("contract.move");
  const fileRef = useRef<HTMLInputElement>(null);

  // Privacy consent
  const [publishOnChain, setPublishOnChain] = useState(false);

  // Submit state
  const [submitting, setSubmitting] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

  // Cetus hero "Re-run live" — pre-fills the address tab with the Cetus package ID
  function runLiveCetusAudit() {
    setTab("address");
    setAddress(CETUS_PACKAGE_ID);
    setAddressError(null);
    setApiError(null);
    setNetwork("mainnet");
  }

  // ── Validation ──────────────────────────────────────────────────────────────

  function validateAddress(val: string): string | null {
    if (!val.trim()) return "Package address is required";
    if (!ADDRESS_RE.test(val.trim())) {
      return 'Must be a 0x-prefixed 64-character hex address (e.g. 0x2…)';
    }
    return null;
  }

  function handleAddressChange(val: string) {
    setAddress(val);
    // Clear error once user starts typing valid input
    if (addressError && ADDRESS_RE.test(val.trim())) setAddressError(null);
  }

  // ── File picker ─────────────────────────────────────────────────────────────

  function handleFilePick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => setSourceText((ev.target?.result as string) ?? "");
    reader.readAsText(file);
  }

  // ── Submit ──────────────────────────────────────────────────────────────────

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setApiError(null);

    if (tab === "address") {
      const err = validateAddress(address);
      if (err) { setAddressError(err); return; }
    } else {
      if (!sourceText.trim()) {
        setApiError("Paste or upload at least one .move file");
        return;
      }
    }

    setSubmitting(true);

    try {
      const body =
        tab === "address"
          ? { packageId: address.trim(), network, publishOnChain }
          : { source: { files: [{ name: fileName, content: sourceText }] }, network, publishOnChain };

      const res = await fetch("/api/audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json() as { auditId?: string; error?: string };

      if (!res.ok || !data.auditId) {
        setApiError(data.error ?? `Server error ${res.status}`);
        return;
      }

      router.push(`/audit/${data.auditId}`);
    } catch (err) {
      setApiError(err instanceof Error ? err.message : "Network error — is the dev server running?");
    } finally {
      setSubmitting(false);
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex flex-col">

      {/* ── Nav ──────────────────────────────────────────────────────────── */}
      <nav className="border-b border-gray-800 px-6 py-3 flex items-center gap-3">
        <ShieldIcon className="w-6 h-6 text-cyan-400" />
        <span className="font-bold text-white tracking-tight text-lg">MoveLens</span>
        <span className="text-gray-500 text-sm ml-1">/ Sui Move Security Auditor</span>
        <div className="ml-auto flex gap-2">
          <LayerBadge label="Layer 1 · Deterministic" color="bg-cyan-900/40 text-cyan-300" />
          <LayerBadge label="Layer 2 · OZ Benchmark" color="bg-violet-900/40 text-violet-300" />
          <LayerBadge label="Walrus" color="bg-blue-900/40 text-blue-300" />
          <LayerBadge label="Seal" color="bg-green-900/40 text-green-300" />
        </div>
      </nav>

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section className="flex-1 flex flex-col items-center justify-center px-6 py-16">

        <div className="mb-3 flex items-center gap-2">
          <ShieldIcon className="w-10 h-10 text-cyan-400" />
          <h1 className="text-5xl font-extrabold tracking-tight text-white">
            Move<span className="text-cyan-400">Lens</span>
          </h1>
        </div>

        <p className="text-xl text-gray-400 mb-2 text-center max-w-xl">
          Zero-cost, 4-layer security analysis for Sui Move smart contracts.
        </p>
        <p className="text-sm text-gray-600 mb-8 text-center">
          65 regex rules · OZ deviation checks · Walrus-stored encrypted reports · Seal-encrypted findings
        </p>

        {/* ── Cetus hero ──────────────────────────────────────────────────── */}
        <CetusHero
          entry={(galleryData as GalleryEntry[])[0]}
          onRunLive={runLiveCetusAudit}
        />

        {/* ── Input card ─────────────────────────────────────────────────── */}
        <div className="w-full max-w-2xl bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl overflow-hidden">

          {/* Tabs */}
          <div className="flex border-b border-gray-700">
            <button
              type="button"
              onClick={() => { setTab("address"); setApiError(null); }}
              className={`flex-1 py-3 text-sm font-medium transition-colors ${
                tab === "address"
                  ? "bg-gray-800 text-cyan-400 border-b-2 border-cyan-400"
                  : "text-gray-500 hover:text-gray-300"
              }`}
            >
              📦 Package Address
            </button>
            <button
              type="button"
              onClick={() => { setTab("source"); setApiError(null); }}
              className={`flex-1 py-3 text-sm font-medium transition-colors ${
                tab === "source"
                  ? "bg-gray-800 text-cyan-400 border-b-2 border-cyan-400"
                  : "text-gray-500 hover:text-gray-300"
              }`}
            >
              📄 Paste Source
            </button>
          </div>

          <form onSubmit={handleSubmit} className="p-6 space-y-4">

            {tab === "address" && (
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1.5">
                  Sui Package Address
                </label>
                <input
                  type="text"
                  value={address}
                  onChange={(e) => handleAddressChange(e.target.value)}
                  onBlur={() => setAddressError(validateAddress(address))}
                  placeholder="0x0000000000000000000000000000000000000000000000000000000000000002"
                  spellCheck={false}
                  className={`w-full rounded-lg px-4 py-2.5 bg-gray-800 border text-sm font-mono text-gray-100 placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-cyan-500 transition-colors ${
                    addressError
                      ? "border-red-500 focus:ring-red-500"
                      : "border-gray-600 hover:border-gray-500"
                  }`}
                />
                {addressError && (
                  <p className="mt-1.5 text-xs text-red-400 flex items-center gap-1">
                    <span>⚠</span> {addressError}
                  </p>
                )}
              </div>
            )}

            {tab === "source" && (
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <label className="block text-xs font-medium text-gray-400">
                    File name
                  </label>
                  <input
                    type="text"
                    value={fileName}
                    onChange={(e) => setFileName(e.target.value)}
                    className="flex-1 rounded-lg px-3 py-1.5 bg-gray-800 border border-gray-600 text-xs font-mono text-gray-100 focus:outline-none focus:ring-1 focus:ring-cyan-500"
                  />
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    className="text-xs text-cyan-400 hover:text-cyan-300 border border-cyan-700 rounded-lg px-3 py-1.5 transition-colors"
                  >
                    Upload file
                  </button>
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".move"
                    onChange={handleFilePick}
                    className="hidden"
                  />
                </div>
                <textarea
                  value={sourceText}
                  onChange={(e) => setSourceText(e.target.value)}
                  placeholder={`module example::contract {\n  // Paste your Move source here…\n}`}
                  rows={10}
                  spellCheck={false}
                  className="w-full rounded-lg px-4 py-3 bg-gray-800 border border-gray-600 text-sm font-mono text-gray-100 placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-cyan-500 resize-y"
                />
                <p className="text-xs text-gray-600">
                  Single .move file · max 1 MB · must contain a <code className="text-gray-400">module</code> declaration
                </p>
              </div>
            )}

            {/* Network selector */}
            <div className="flex items-center gap-3">
              <label className="text-xs font-medium text-gray-400">Network</label>
              <div className="flex rounded-lg overflow-hidden border border-gray-600">
                {(["testnet", "mainnet"] as Network[]).map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setNetwork(n)}
                    className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                      network === n
                        ? "bg-cyan-700 text-white"
                        : "bg-gray-800 text-gray-400 hover:text-gray-200"
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
              {network === "mainnet" && (
                <span className="text-xs text-amber-400">⚠ mainnet — uses real SUI gas</span>
              )}
            </div>

            {/* Privacy consent */}
            <label className="flex items-start gap-3 cursor-pointer group">
              <input
                type="checkbox"
                checked={publishOnChain}
                onChange={(e) => setPublishOnChain(e.target.checked)}
                className="mt-0.5 accent-cyan-500 w-4 h-4 shrink-0"
              />
              <span className="text-xs text-gray-400 group-hover:text-gray-300 transition-colors">
                <span className="font-medium text-gray-300">Publish audit on-chain</span> — write the
                Walrus blob ID to the MoveLens PackageInfo object via an MVR transaction.
                Your package address will be included in the on-chain record.
                Leave unchecked to keep the audit report off-chain only.
              </span>
            </label>

            {/* API error */}
            {apiError && (
              <div className="rounded-lg bg-red-950/50 border border-red-700 px-4 py-3 text-sm text-red-300">
                {apiError}
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={submitting}
              className="w-full py-3 rounded-xl font-semibold text-sm bg-cyan-600 hover:bg-cyan-500 disabled:bg-gray-700 disabled:text-gray-500 text-white transition-colors flex items-center justify-center gap-2"
            >
              {submitting ? (
                <>
                  <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                  Starting audit…
                </>
              ) : (
                <>
                  <ShieldIcon className="w-4 h-4" />
                  Run Audit
                </>
              )}
            </button>
          </form>
        </div>

        {/* ── Architecture callout ─────────────────────────────────────────── */}
        <div className="mt-10 grid grid-cols-2 sm:grid-cols-4 gap-3 w-full max-w-2xl text-center">
          {[
            { num: "65", label: "Regex rules (13 sectors)", color: "text-cyan-400" },
            { num: "10", label: "OZ deviation checks", color: "text-violet-400" },
            { num: "5", label: "Walrus storage epochs", color: "text-blue-400" },
            { num: "AES-256", label: "Seal encryption", color: "text-green-400" },
          ].map(({ num, label, color }) => (
            <div key={label} className="bg-gray-900 border border-gray-800 rounded-xl p-3">
              <div className={`text-xl font-bold ${color}`}>{num}</div>
              <div className="text-xs text-gray-500 mt-0.5">{label}</div>
            </div>
          ))}
        </div>

        {/* ── Audit Gallery ───────────────────────────────────────────────── */}
        <div className="mt-16 w-full max-w-4xl">
          <h2 className="text-lg font-semibold text-gray-300 mb-4 text-center tracking-tight">
            Recent Public Audits
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {(galleryData as GalleryEntry[]).map((entry) => (
              <div
                key={entry.id}
                className="bg-gray-900 border border-gray-700 rounded-xl p-4 flex flex-col gap-3"
              >
                {/* Header row */}
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-sm font-semibold text-white truncate">
                      {entry.packageName}
                    </div>
                    <span
                      className={`inline-block mt-0.5 text-xs px-2 py-0.5 rounded-full font-medium ${
                        entry.network === "mainnet"
                          ? "bg-amber-900/40 text-amber-300"
                          : "bg-cyan-900/40 text-cyan-300"
                      }`}
                    >
                      {entry.network}
                    </span>
                  </div>
                  {/* Risk grade badge */}
                  <RiskGradeBadge grade={entry.riskGrade} />
                </div>

                {/* Severity counts */}
                <div className="flex gap-2 text-xs">
                  <span className="text-red-400 font-semibold">
                    {entry.severityCounts.critical}C
                  </span>
                  <span className="text-orange-400 font-semibold">
                    {entry.severityCounts.high}H
                  </span>
                  <span className="text-yellow-400 font-semibold">
                    {entry.severityCounts.medium}M
                  </span>
                  <span className="text-gray-400 font-semibold">
                    {entry.severityCounts.low}L
                  </span>
                  <span className="ml-auto text-gray-500">
                    {entry.totalFindings} findings
                  </span>
                </div>

                {/* Highlight (Cetus-specific call-out) */}
                {entry.highlight && (
                  <p className="text-xs text-amber-300/80 bg-amber-950/30 border border-amber-800/30 rounded px-2 py-1 leading-snug">
                    {entry.highlight}
                  </p>
                )}

                {/* Layers run */}
                <div className="flex flex-wrap gap-1">
                  {entry.layersRun.map((l) => (
                    <span
                      key={l}
                      className="text-xs bg-gray-800 text-gray-400 px-1.5 py-0.5 rounded"
                    >
                      {l}
                    </span>
                  ))}
                </div>

                {/* Walrus blob link */}
                <a
                  href={entry.walrusUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-auto text-xs text-cyan-400 hover:text-cyan-300 underline underline-offset-2 break-all transition-colors"
                >
                  View on Walrus ↗
                </a>
              </div>
            ))}
          </div>
        </div>

      </section>

      {/* ── Footer ───────────────────────────────────────────────────────── */}
      <footer className="border-t border-gray-800 py-3 px-6 text-center text-xs text-gray-600">
        Automated pre-screen — not a substitute for a human audit. · Sui Overflow 2026 · Walrus Track
      </footer>

    </div>
  );
}
