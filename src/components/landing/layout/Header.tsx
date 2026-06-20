export function Header() {
  return (
    <header className="absolute top-0 left-0 right-0 z-50 bg-transparent">
      <div className="w-full px-8 md:px-12 py-5 flex items-center justify-between">
        <div className="flex items-center">
          <img src="/Logo.png" alt="MoveLens" className="h-16 w-auto object-contain" />
        </div>

        <nav className="hidden md:flex gap-8 text-sm text-[var(--text-secondary)] font-medium items-center">
          <a href="#solution" className="hover:text-[var(--text-primary)] transition-all flex items-center gap-0.5">Solution <span className="opacity-60">↓</span></a>
          <a href="#how-it-works" className="hover:text-[var(--text-primary)] transition-all flex items-center gap-0.5">How It Works <span className="opacity-60">↓</span></a>
          <a href="#demo" className="hover:text-[var(--text-primary)] transition-all flex items-center gap-0.5">Live Demo <span className="opacity-60">↓</span></a>
          <a href="#trust" className="hover:text-[var(--text-primary)] transition-all flex items-center gap-0.5">Trust <span className="opacity-60">↓</span></a>
          <a href="/mcp" className="hover:text-[var(--text-primary)] transition-all flex items-center gap-0.5">MCP <span className="opacity-60">↓</span></a>
        </nav>

        <div>
          <a
            href="/app"
            className="px-5 py-2.5 border border-white/10 rounded-full font-medium text-xs hover:border-white/20 transition-all text-[var(--text-primary)] inline-flex items-center gap-1.5"
          >
            Launch app <span className="opacity-80">→</span>
          </a>
        </div>
      </div>
    </header>
  );
}
