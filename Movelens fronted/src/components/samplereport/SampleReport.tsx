"use client";

import { useState } from "react";

const FINDINGS = [
  {
    id: "MLF-001",
    severity: "CRITICAL",
    title: "Unchecked Integer Overflow in swap_exact_input()",
    location: "v2_pool::swap_exact_input · line 247",
    description:
      "The u64 arithmetic in the swap output calculation silently overflows when pool reserves exceed threshold, allowing an attacker to drain the pool for near-zero input. This is a Cetus-class exploit pattern.",
    code: `public fun swap_exact_input(
  pool: &mut Pool,
  amount_in: u64,
) : u64 {
  // ⚠ overflow: no checked_add / checked_mul
  let amount_out = amount_in * pool.reserve_b / pool.reserve_a;
  pool.reserve_a = pool.reserve_a + amount_in;
  pool.reserve_b = pool.reserve_b - amount_out;
  amount_out
}`,
    impact: "Pool funds fully drainable. Estimated max loss: all TVL.",
  },
  {
    id: "MLF-002",
    severity: "HIGH",
    title: "AdminCap Leaked via public_transfer()",
    location: "v2_pool::init · line 34",
    description:
      "AdminCap is created with transfer::public_transfer, meaning any address can claim ownership on the first call. No signer check is enforced during initialization.",
    code: `fun init(ctx: &mut TxContext) {
  // ⚠ should be transfer::transfer, not public_transfer
  transfer::public_transfer(
    AdminCap { id: object::new(ctx) },
    ctx.sender()
  );
}`,
    impact: "Full admin takeover possible by any actor on first init call.",
  },
  {
    id: "MLF-003",
    severity: "MEDIUM",
    title: "Unsafe Upgrade — Missing Version Guard",
    location: "v2_pool::upgrade · line 89",
    description:
      "The package exposes upgrade_cap without a version migration lock. A future upgrade could silently change fee logic or drain logic without user awareness or a timelock delay.",
    code: `public fun upgrade(
  cap: UpgradeCap,
  policy: u8,
  digest: vector<u8>,
) {
  // ⚠ no version check, no timelock enforced
  package::commit_upgrade(cap, receipt);
}`,
    impact: "Silent malicious upgrade is possible post-deployment.",
  },
  {
    id: "MLF-004",
    severity: "LOW",
    title: "Missing Event Emission on Fee Update",
    location: "v2_pool::set_fee · line 156",
    description:
      "Fee parameter mutations occur without emitting an on-chain event. This reduces off-chain auditability and breaks any indexer watching for fee changes.",
    code: `public fun set_fee(
  pool: &mut Pool,
  new_fee: u64,
  _: &AdminCap,
) {
  pool.fee_bps = new_fee;
  // ⚠ no event::emit() call here
}`,
    impact: "Reduced auditability. No indexer alert on fee change.",
  },
];

const SEVERITY_CONFIG: Record<string, { color: string; bg: string; dot: string; border: string }> = {
  CRITICAL: {
    color: "var(--severity-critical)",
    bg: "rgba(255,92,92,0.08)",
    dot: "#ff5c5c",
    border: "rgba(255,92,92,0.25)",
  },
  HIGH: {
    color: "var(--severity-high)",
    bg: "rgba(255,139,92,0.08)",
    dot: "#ff8b5c",
    border: "rgba(255,139,92,0.25)",
  },
  MEDIUM: {
    color: "var(--severity-medium)",
    bg: "rgba(255,193,92,0.08)",
    dot: "#ffc15c",
    border: "rgba(255,193,92,0.25)",
  },
  LOW: {
    color: "var(--severity-low)",
    bg: "rgba(92,201,245,0.08)",
    dot: "#5cc9f5",
    border: "rgba(92,201,245,0.25)",
  },
};

const SEVERITY_ORDER = ["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const;
type Severity = (typeof SEVERITY_ORDER)[number];
type FilterType = Severity | "ALL";

export function SampleReport() {
  const [expanded, setExpanded] = useState<string | null>("MLF-001");
  const [filter, setFilter] = useState<FilterType>("ALL");

  const counts = SEVERITY_ORDER.reduce(
    (acc, s) => {
      acc[s] = FINDINGS.filter((f) => f.severity === s).length;
      return acc;
    },
    {} as Record<Severity, number>
  );

  const filtered =
    filter === "ALL" ? FINDINGS : FINDINGS.filter((f) => f.severity === filter);

  return (
    <section className="relative w-full bg-black px-6 py-20 sm:py-28">
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

      {/* Report panel */}
      <div className="max-w-[860px] mx-auto">
        <div
          className="rounded-[28px] sm:rounded-[36px] overflow-hidden border border-white/[0.07]"
          style={{
            background: "rgba(255,255,255,0.02)",
            backdropFilter: "blur(40px)",
            WebkitBackdropFilter: "blur(40px)",
            boxShadow: "0 32px 80px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.06)",
          }}
        >
          {/* ── Report header ── */}
          <div
            className="px-6 sm:px-8 py-6 border-b border-white/[0.06]"
            style={{ background: "rgba(255,255,255,0.015)" }}
          >
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="font-mono-plex text-[10px] tracking-[0.12em] uppercase text-[var(--text-tertiary)]">
                    MVR
                  </span>
                  <span className="font-mono-plex text-[11px] text-[var(--brand-lavender)]">
                    @cetus/amm
                  </span>
                </div>
                <h3 className="font-display font-bold text-[20px] sm:text-[26px] text-white tracking-[-0.02em]">
                  cetus_amm · v2_pool
                </h3>
                <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                  <span className="font-mono-plex text-[11px] text-[var(--text-tertiary)]">
                    0x1eab4a9f…c3f280
                  </span>
                  <span className="text-white/20">·</span>
                  <span className="font-mono-plex text-[11px] text-[var(--text-tertiary)]">
                    Jan 12 2025
                  </span>
                </div>
              </div>

              <div className="flex flex-col items-end gap-2 flex-shrink-0">
                <div
                  className="px-3 py-1.5 rounded-full text-[11px] font-semibold tracking-wide font-mono-plex"
                  style={{
                    background: "rgba(255,92,92,0.12)",
                    color: "#ff5c5c",
                    border: "1px solid rgba(255,92,92,0.28)",
                  }}
                >
                  ● HIGH RISK
                </div>
                <div className="flex items-center gap-1.5">
                  <img src="/seal.png" alt="" className="w-3.5 h-3.5 opacity-50" />
                  <span className="font-mono-plex text-[10px] text-[var(--text-tertiary)]">
                    Sealed · Walrus
                  </span>
                </div>
              </div>
            </div>

            {/* Severity pill row */}
            <div className="mt-5 flex gap-2 flex-wrap">
              {SEVERITY_ORDER.map((s) => {
                const cfg = SEVERITY_CONFIG[s];
                return (
                  <div
                    key={s}
                    className="flex items-center gap-1.5 px-3 py-1 rounded-full"
                    style={{
                      background: cfg.bg,
                      border: `1px solid ${cfg.border}`,
                    }}
                  >
                    <span
                      className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                      style={{ background: cfg.dot }}
                    />
                    <span
                      className="font-mono-plex text-[10px] sm:text-[11px] font-medium"
                      style={{ color: cfg.color }}
                    >
                      {counts[s]} {s}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* ── Filter bar ── */}
          <div className="px-6 sm:px-8 pt-4 pb-3 flex items-center gap-2 flex-wrap border-b border-white/[0.04]">
            <span className="font-mono-plex text-[10px] tracking-[0.1em] uppercase text-[var(--text-tertiary)] mr-1">
              Filter
            </span>
            {(["ALL", ...SEVERITY_ORDER] as FilterType[]).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className="px-3 py-1 rounded-full text-[11px] font-medium transition-all duration-150 cursor-pointer font-mono-plex"
                style={
                  filter === f
                    ? {
                        background: "rgba(255,255,255,0.1)",
                        color: "white",
                        border: "1px solid rgba(255,255,255,0.18)",
                      }
                    : {
                        background: "transparent",
                        color: "var(--text-tertiary)",
                        border: "1px solid transparent",
                      }
                }
              >
                {f === "ALL" ? `All ${FINDINGS.length}` : f}
              </button>
            ))}
          </div>

          {/* ── Findings list ── */}
          <div className="px-4 sm:px-6 py-4 flex flex-col gap-2">
            {filtered.map((finding) => {
              const cfg = SEVERITY_CONFIG[finding.severity];
              const isOpen = expanded === finding.id;

              return (
                <div
                  key={finding.id}
                  className="rounded-[16px] sm:rounded-[20px] overflow-hidden transition-all duration-200"
                  style={{
                    border: isOpen
                      ? `1px solid ${cfg.border}`
                      : "1px solid rgba(255,255,255,0.05)",
                    background: isOpen ? cfg.bg : "rgba(255,255,255,0.02)",
                  }}
                >
                  {/* Finding header row */}
                  <button
                    onClick={() => setExpanded(isOpen ? null : finding.id)}
                    className="w-full px-4 sm:px-5 py-4 flex items-start gap-3 sm:gap-4 text-left cursor-pointer"
                  >
                    {/* Severity badge */}
                    <div className="flex items-center gap-1.5 mt-0.5 flex-shrink-0 min-w-[90px]">
                      <span
                        className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                        style={{ background: cfg.dot }}
                      />
                      <span
                        className="font-mono-plex text-[10px] tracking-[0.07em] uppercase font-medium"
                        style={{ color: cfg.color }}
                      >
                        {finding.severity}
                      </span>
                    </div>

                    {/* Title block */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="font-mono-plex text-[10px] text-[var(--text-tertiary)]">
                          {finding.id}
                        </span>
                      </div>
                      <p className="font-display font-medium text-[14px] sm:text-[16px] text-white leading-[1.35]">
                        {finding.title}
                      </p>
                      <p className="font-mono-plex text-[10px] sm:text-[11px] text-[var(--text-tertiary)] mt-1">
                        {finding.location}
                      </p>
                    </div>

                    {/* Chevron */}
                    <span
                      className="text-[var(--text-tertiary)] flex-shrink-0 mt-1 text-xs transition-transform duration-200"
                      style={{ transform: isOpen ? "rotate(180deg)" : "rotate(0deg)" }}
                    >
                      ↓
                    </span>
                  </button>

                  {/* Expanded body */}
                  {isOpen && (
                    <div className="px-4 sm:px-5 pb-5">
                      <p className="text-[13px] sm:text-[14px] leading-[1.7] text-[var(--text-secondary)] mb-4">
                        {finding.description}
                      </p>

                      {/* Code block */}
                      <pre
                        className="rounded-[12px] p-4 text-[11px] sm:text-[12px] leading-[1.75] overflow-x-auto font-mono-plex"
                        style={{
                          background: "rgba(0,0,0,0.55)",
                          border: "1px solid rgba(255,255,255,0.06)",
                          color: "#a8d4a0",
                        }}
                      >
                        {finding.code}
                      </pre>

                      {/* Impact line */}
                      <div className="mt-3 flex items-start gap-2">
                        <span className="font-mono-plex text-[10px] tracking-[0.08em] uppercase text-[var(--text-tertiary)] flex-shrink-0 mt-0.5">
                          Impact ·
                        </span>
                        <span
                          className="text-[12px] sm:text-[13px] leading-[1.5] font-sans-switzer"
                          style={{ color: cfg.color }}
                        >
                          {finding.impact}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* ── Walrus proof footer ── */}
          <div
            className="px-6 sm:px-8 py-4 sm:py-5 border-t border-white/[0.06] flex items-center justify-between gap-4 flex-wrap"
            style={{ background: "rgba(255,255,255,0.01)" }}
          >
            <div className="flex items-center gap-3">
              <img src="/wal.png" alt="Walrus" className="w-5 h-5 opacity-60" />
              <div>
                <div className="font-mono-plex text-[10px] tracking-[0.1em] uppercase text-[var(--text-tertiary)]">
                  Stored on Walrus
                </div>
                <div className="font-mono-plex text-[11px] text-[var(--text-secondary)] mt-0.5">
                  Blob · 4xK9mR2p…Xy7NqE
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <img src="/sui.png" alt="Sui" className="w-4 h-4 opacity-50" />
              <span className="font-mono-plex text-[11px] text-[var(--text-tertiary)]">
                Linked via MVR on-chain
              </span>
            </div>
          </div>
        </div>

        {/* CTA */}
        <div className="mt-8 flex justify-center">
          <button className="bg-[var(--brand-lavender)] hover:bg-[var(--brand-lavender-hover)] text-[var(--ink)] px-8 py-3.5 rounded-full text-sm font-semibold tracking-wide transition-all flex items-center gap-2 cursor-pointer shadow-lg">
            Run your own audit <span className="opacity-80 text-xs">↗</span>
          </button>
        </div>
      </div>
    </section>
  );
}
