export function LiveDemoHero() {
  return (
    <section className="relative w-full bg-black px-6 pt-20 sm:pt-24 pb-64 sm:pb-80 md:pb-96">
      <div className="relative max-w-[1320px] mx-auto">
        <div className="relative rounded-[48px] overflow-hidden min-h-[480px] sm:min-h-[560px] flex flex-col items-center">
          <img
            src="/Aurora2.png"
            alt=""
            className="absolute inset-0 w-full h-full object-cover object-top -translate-y-6 pointer-events-none select-none"
          />
          <div className="absolute inset-0 bg-grain opacity-[0.1] mix-blend-overlay pointer-events-none select-none" />

          <div className="relative z-10 mt-10 sm:mt-18 inline-flex items-center px-4 py-2 rounded-full bg-black/30 backdrop-blur-md">
            <span className="font-mono-plex text-[11px] sm:text-[12px] tracking-[0.1em] uppercase text-[var(--text-primary)]">
              Live Demo
            </span>
          </div>

          <h2 className="relative z-10 mt-6 sm:mt-8 text-center font-display font-semibold text-[58px] sm:text-[88px] md:text-[120px] leading-[1.0] tracking-[-0.02em] text-[var(--text-primary)] max-w-[1240px] px-6">
            Watch your contract
            <br />
            get audited.
          </h2>

          {/* Mascot inside the rectangle */}
          <div className="relative z-10 -mt-14 sm:-mt-18 md:-mt-28 mb-0 pointer-events-none select-none">
            <img
              src="/2.png"
              alt="MoveLens mascot"
              className="w-[520px] sm:w-[600px] md:w-[760px] h-auto object-contain"
            />
          </div>
        </div>

        {/* Video below the rectangle, same slot the mascot used to occupy */}
        <div className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-[65%] w-[340px] sm:w-[580px] md:w-[1000px] z-20">
          <div className="relative w-full rounded-[24px] overflow-hidden bg-black/40 ring-1 ring-white/10" style={{ aspectRatio: "16/9" }}>
            <iframe
              src="https://www.youtube.com/embed/lhozR8KO6-g?start=23&rel=0&modestbranding=1"
              title="MoveLens live demo"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              className="absolute inset-0 w-full h-full border-0"
            />
          </div>
        </div>
      </div>
    </section>
  );
}
