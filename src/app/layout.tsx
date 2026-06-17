import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MoveLens · A flashlight for Move contracts",
  description: "AI security auditor for Sui Move packages. Permanent, encrypted, and verifiable vulnerability reports stored on Walrus.",
  icons: {
    icon: "/Logo.png",
    apple: "/Logo.png",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased">
      <head>
        <link rel="preconnect" href="https://api.fontshare.com" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://api.fontshare.com/v2/css?f[]=cabinet-grotesk@100,200,300,400,500,700,800,900&f[]=switzer@100,200,300,400,500,600,700,800,900&display=swap"
          rel="stylesheet"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-full flex flex-col bg-black text-[var(--text-primary)] selection:bg-[var(--brand-lavender)] selection:text-[var(--ink)]">
        {/* SVG Filters */}
        <svg width="0" height="0" className="absolute pointer-events-none" aria-hidden="true">
          <defs>
            <filter id="ml-grain">
              <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch"/>
              <feColorMatrix values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.45 0"/>
            </filter>
            <radialGradient id="ml-plush" cx="35%" cy="28%" r="80%">
              <stop offset="0%" stopColor="#9fcfff"/>
              <stop offset="55%" stopColor="#4da2ff"/>
              <stop offset="100%" stopColor="#1f5fa8"/>
            </radialGradient>
            <radialGradient id="ml-goggle" cx="32%" cy="28%" r="85%">
              <stop offset="0%" stopColor="#ffffff"/>
              <stop offset="22%" stopColor="#e6e2ff"/>
              <stop offset="55%" stopColor="#b8b4ff"/>
              <stop offset="100%" stopColor="#1a1a26"/>
            </radialGradient>
          </defs>
        </svg>

        {/* Film Grain Overlay */}
        <div
          aria-hidden="true"
          className="fixed inset-0 pointer-events-none opacity-6 mix-blend-overlay"
          style={{ zIndex: 9999 }}
        >
          <svg width="100%" height="100%">
            <rect width="100%" height="100%" filter="url(#ml-grain)"/>
          </svg>
        </div>

        {children}
      </body>
    </html>
  );
}
