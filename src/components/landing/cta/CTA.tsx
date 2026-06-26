export function CTA() {
  return (
    <section className="relative w-full z-10 flex-1">
      <div className="relative min-h-[950px] w-full flex flex-col items-center justify-start pt-32 sm:pt-40 md:pt-40 px-6">
        <div className="absolute inset-x-0 top-[120px] sm:top-[160px] md:top-[200px] w-full pointer-events-none select-none z-0">
          <img src="/Aurora.png" alt="" className="w-full h-auto opacity-90" />
          <div className="absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-black to-transparent pointer-events-none" />
          <div className="absolute inset-x-0 bottom-0 h-[450px] bg-gradient-to-t from-black via-black/30 to-transparent pointer-events-none" />
          <div className="absolute inset-0 bg-grain opacity-[0.06] mix-blend-overlay pointer-events-none" />
        </div>

        <div className="max-w-[1200px] w-full mx-auto text-center flex flex-col items-center relative z-20">
          <h1 className="font-display font-bold text-[40px] sm:text-[100px] md:text-[116px] lg:text-[128px] leading-[0.9] tracking-[-0.035em] text-white mb-6 max-w-5xl">
            Don&rsquo;t ship your
            <br />
            contract blind.
          </h1>
          <a
            href="/app"
            className="mt-8 bg-[var(--brand-lavender)] hover:bg-[var(--brand-lavender-hover)] text-[var(--ink)] px-10 py-4 rounded-full text-sm font-semibold tracking-wide transition-all inline-flex items-center gap-2 cursor-pointer shadow-lg"
          >
            Audit your contract <span className="opacity-80 text-xs">↗</span>
          </a>
        </div>

        <div className="absolute bottom-0 left-0 right-0 w-full flex flex-col items-center justify-end z-10 h-[480px]">
          <div className="relative w-full max-w-[840px] flex justify-center z-10 translate-y-[25%] select-none pointer-events-none">
            <img src="/3.png" alt="MoveLens Mascot" className="w-[90%] sm:w-full h-auto object-contain object-bottom" />
          </div>
        </div>
      </div>
    </section>
  );
}
