import React from "react";

const CARD_STYLE = {
  background: "rgba(255,255,255,0.04)",
  backdropFilter: "blur(20px)",
  WebkitBackdropFilter: "blur(20px)",
  boxShadow: "0 8px 40px rgba(0,0,0,0.4)",
};

const LOCK_STATES = [
  { label: "Encrypted", sub: "Seal threshold encryption" },
  { label: "Owner review", sub: "Private draft, owner only" },
  { label: "Published", sub: "Key released on-chain" },
];

export function Differentiators() {
  return (
    <section className="relative w-full bg-black px-6 pt-8 sm:pt-10 pb-16 sm:pb-20">

      {/* Section heading */}
      <div className="max-w-[1100px] mx-auto text-center flex flex-col items-center mb-10 sm:mb-14">
        <h2 className="font-display font-bold text-[40px] sm:text-[64px] md:text-[78px] leading-[0.98] tracking-[-0.03em] text-white">
          Built different,
          <br />
          on purpose.
        </h2>
      </div>

      {/* Card grid */}
      <div className="max-w-[1100px] mx-auto grid grid-cols-1 lg:grid-cols-[3fr_2fr] gap-5 lg:gap-6">

        {/* ── Card 1: Featured ── */}
        <div
          className="lg:row-span-2 rounded-[24px] flex flex-col p-8 sm:p-10 lg:p-12"
          style={CARD_STYLE}
        >
          {/* Top: icon + headline + body */}
          <div className="flex-1 flex flex-col">
            <img src="/S1.png" alt="" className="w-10 h-10 sm:w-12 sm:h-12 object-contain mb-8" />

            <h3 className="font-display font-bold text-[32px] sm:text-[38px] lg:text-[44px] leading-[1.05] tracking-[-0.02em] text-[var(--text-primary)] mb-6 max-w-[420px]">
              Your report stays private until you say so.
            </h3>

            <p className="text-[16px] sm:text-[17px] lg:text-[18px] leading-[1.65] text-[var(--text-secondary)] font-sans-switzer max-w-[460px]">
              Every audit is encrypted with Seal&rsquo;s threshold encryption before
              it touches storage. The contract owner gets the private draft first —
              no finding goes public until they choose to publish the decryption key.
              Vulnerabilities don&rsquo;t become exploits before they&rsquo;re fixed.
            </p>
          </div>

          {/* Bottom: 3 lavender mini-cards */}
          <div className="mt-10 grid grid-cols-3 gap-3">
            {LOCK_STATES.map((state) => (
              <div
                key={state.label}
                className="flex flex-col gap-1.5 rounded-[14px] px-4 py-4"
                style={{
                  background: "#CAB1FF",
                  border: "1px solid rgba(202,177,255,0.4)",
                }}
              >
                <span
                  className="font-display font-bold text-white"
                  style={{ fontSize: 15, lineHeight: 1.2 }}
                >
                  {state.label}
                </span>
                <span
                  className="font-sans-switzer"
                  style={{ fontSize: 12, lineHeight: 1.45, color: "rgba(255,255,255,0.45)" }}
                >
                  {state.sub}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* ── Card 2: MemWal ── */}
        <div
          className="rounded-[24px] flex flex-col justify-between p-7 sm:p-8"
          style={CARD_STYLE}
        >
          <div>
            <img src="/S2.png" alt="" className="w-10 h-10 sm:w-12 sm:h-16 object-contain mb-6" />
            <h3 className="font-display font-bold text-[22px] sm:text-[26px] leading-[1.1] tracking-[-0.01em] text-[var(--text-primary)] mb-3">
              It remembers every contract it&rsquo;s ever seen.
            </h3>
          </div>
          <p className="text-[14px] sm:text-[15px] leading-[1.6] text-[var(--text-secondary)] font-sans-switzer">
            The engine recalls similar patterns from past audits stored on Walrus Memory before flagging anything new. Every audit sharpens the next one.
          </p>
        </div>

        {/* ── Card 3: OZ Benchmark ── */}
        <div
          className="rounded-[24px] flex flex-col justify-between p-7 sm:p-8"
          style={CARD_STYLE}
        >
          <div>
            <img src="/S3.png" alt="" className="w-10 h-10 sm:w-12 sm:h-12 object-contain mb-6" />
            <h3 className="font-display font-bold text-[22px] sm:text-[26px] leading-[1.1] tracking-[-0.01em] text-[var(--text-primary)] mb-3">
              Checked against math that survived an audit.
            </h3>
          </div>
          <p className="text-[14px] sm:text-[15px] leading-[1.6] text-[var(--text-secondary)] font-sans-switzer">
            Every arithmetic op is benchmarked against OpenZeppelin&rsquo;s audited DeFi math library, with a priority check for Cetus-class overflow patterns.
          </p>
        </div>

      </div>
    </section>
  );
}
