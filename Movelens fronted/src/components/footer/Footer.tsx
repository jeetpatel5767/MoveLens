export function Footer() {
  return (
    <footer className="relative z-50 w-full pb-0 bg-white/[0.005] backdrop-blur-sm backdrop-saturate-150 border-t border-white/[0.06] rounded-t-[48px] shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_-20px_60px_rgba(0,0,0,0.35)]">
      <div className="max-w-[1100px] mx-auto px-6 pt-16 sm:pt-20 pb-10 sm:pb-12">

        {/* Columns + docs button */}
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-10">

          {/* Link columns */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-10 sm:gap-16">

            {/* Product */}
            <div className="flex flex-col gap-5">
              <span className="font-mono-plex text-[11px] uppercase tracking-[0.1em]" style={{ color: "var(--brand-lavender)" }}>
                Product
              </span>
              <ul className="flex flex-col gap-4">
                {[
                  { label: "How it works" },
                  { label: "Sample report" },
                  { label: "Run an audit", arrow: true },
                ].map((item) => (
                  <li key={item.label}>
                    <a href="#" className="flex items-center gap-1.5 text-[16px] text-white hover:text-[var(--text-secondary)] transition-colors font-sans-switzer">
                      {item.label}
                      {item.arrow && <span className="text-[13px] opacity-50">↗</span>}
                    </a>
                  </li>
                ))}
              </ul>
            </div>

            {/* Ecosystem */}
            <div className="flex flex-col gap-5">
              <span className="font-mono-plex text-[11px] uppercase tracking-[0.1em]" style={{ color: "var(--brand-lavender)" }}>
                Ecosystem
              </span>
              <ul className="flex flex-col gap-4">
                {[
                  { label: "Walrus", arrow: true },
                  { label: "Seal", arrow: true },
                  { label: "MVR", arrow: true },
                  { label: "Sui", arrow: true },
                ].map((item) => (
                  <li key={item.label}>
                    <a href="#" className="flex items-center gap-1.5 text-[16px] text-white hover:text-[var(--text-secondary)] transition-colors font-sans-switzer">
                      {item.label}
                      {item.arrow && <span className="text-[13px] opacity-50">↗</span>}
                    </a>
                  </li>
                ))}
              </ul>
            </div>

            {/* Resources */}
            <div className="flex flex-col gap-5">
              <span className="font-mono-plex text-[11px] uppercase tracking-[0.1em]" style={{ color: "var(--brand-lavender)" }}>
                Resources
              </span>
              <ul className="flex flex-col gap-4">
                {[
                  { label: "GitHub", arrow: true },
                  { label: "Docs", arrow: true },
                ].map((item) => (
                  <li key={item.label}>
                    <a href="#" className="flex items-center gap-1.5 text-[16px] text-white hover:text-[var(--text-secondary)] transition-colors font-sans-switzer">
                      {item.label}
                      {item.arrow && <span className="text-[13px] opacity-50">↗</span>}
                    </a>
                  </li>
                ))}
              </ul>
            </div>

          </div>

          {/* Read the docs button */}
          <a
            href="#"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full border border-white/10 hover:border-white/20 text-white text-[13px] font-medium font-sans-switzer transition-colors self-start flex-shrink-0"
          >
            Read the docs <span className="opacity-70">→</span>
          </a>

        </div>
      </div>

      {/* Big wordmark — fills full width, no gap at bottom */}
      <div className="w-full overflow-hidden relative">
        <p
          className="font-display font-extrabold text-white select-none text-center"
          style={{
            fontSize: "22.5vw",
            lineHeight: 0.78,
            letterSpacing: "0.0em",
            marginBottom: "-0.15em",
          }}
        >
          MoveLens
        </p>

        {/* Copyright — overlays wordmark, pinned bottom-right */}
        <span
          className="absolute bottom-[80%] right-6 font-sans-switzer text-[13px] text-[var(--text-tertiary)] z-10 select-none"
        >
          © 2026 MoveLens. Built solo for Sui Overflow.
        </span>
      </div>
    </footer>
  );
}
