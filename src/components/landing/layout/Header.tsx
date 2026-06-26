"use client";

import { useState } from "react";

const NAV_LINKS = [
  { label: "Solution",    href: "#solution",  external: false },
  { label: "How It Works", href: "#how-it-works", external: false },
  { label: "Live Demo",   href: "#demo",      external: false },
  { label: "Trust",       href: "#trust",     external: false },
  { label: "MCP",         href: "https://movelens.mintlify.io/mcp/setup", external: true },
];

export function Header() {
  const [open, setOpen] = useState(false);

  return (
    <header className="absolute top-0 left-0 right-0 z-50 bg-transparent">
      <div className="w-full px-6 md:px-12 py-5 flex items-center justify-between">
        <div className="flex items-center">
          <img src="/Logo.png" alt="MoveLens" className="h-12 md:h-16 w-auto object-contain" />
        </div>

        {/* Desktop nav */}
        <nav className="hidden md:flex gap-8 text-sm text-[var(--text-secondary)] font-medium items-center">
          {NAV_LINKS.map(link => (
            <a
              key={link.label}
              href={link.href}
              {...(link.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
              className="hover:text-[var(--text-primary)] transition-all flex items-center gap-0.5"
            >
              {link.label} <span className="opacity-60">{link.external ? "↗" : "↓"}</span>
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-2.5">
          <a
            href="/app"
            className="px-4 py-2 md:px-5 md:py-2.5 border border-white/10 rounded-full font-medium text-xs hover:border-white/20 transition-all text-[var(--text-primary)] inline-flex items-center gap-1.5"
          >
            Launch app <span className="opacity-80">→</span>
          </a>

          {/* Hamburger — mobile only */}
          <button
            type="button"
            aria-label="Toggle navigation"
            onClick={() => setOpen(v => !v)}
            className="md:hidden flex flex-col gap-[5px] justify-center items-center w-9 h-9 rounded-full border border-white/10 hover:border-white/20 transition-all"
          >
            <span className={`block w-4 h-[1.5px] bg-white/80 transition-transform duration-200 origin-center ${open ? "rotate-45 translate-y-[6.5px]" : ""}`} />
            <span className={`block w-4 h-[1.5px] bg-white/80 transition-opacity duration-200 ${open ? "opacity-0" : ""}`} />
            <span className={`block w-4 h-[1.5px] bg-white/80 transition-transform duration-200 origin-center ${open ? "-rotate-45 -translate-y-[6.5px]" : ""}`} />
          </button>
        </div>
      </div>

      {/* Mobile dropdown */}
      <div
        className={`md:hidden absolute top-full left-4 right-4 rounded-2xl border border-white/10 shadow-2xl overflow-hidden transition-all duration-200 origin-top ${
          open ? "opacity-100 scale-y-100" : "opacity-0 scale-y-95 pointer-events-none"
        }`}
        style={{ background: "rgba(10,10,10,0.95)", backdropFilter: "blur(24px)" }}
      >
        <nav className="flex flex-col py-3">
          {NAV_LINKS.map(link => (
            <a
              key={link.label}
              href={link.href}
              {...(link.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
              onClick={() => setOpen(false)}
              className="px-6 py-3.5 text-sm text-[var(--text-secondary)] hover:text-white hover:bg-white/5 transition-all flex items-center justify-between"
            >
              {link.label}
              <span className="opacity-40 text-xs">{link.external ? "↗" : "→"}</span>
            </a>
          ))}
          <div className="px-6 pt-3 pb-3 mt-1 border-t border-white/10">
            <a
              href="/app"
              className="block w-full text-center px-5 py-3 rounded-full font-semibold text-sm transition-all text-[var(--ink)] bg-[var(--brand-lavender)] hover:bg-[var(--brand-lavender-hover)]"
            >
              Launch app →
            </a>
          </div>
        </nav>
      </div>
    </header>
  );
}
