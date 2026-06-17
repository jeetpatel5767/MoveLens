"use client";

import { useEffect, useRef, useState } from "react";

const PHASES = [
  {
    icon: "/S1.png",
    illustration: "/Step1.png",
    label: "PHASE 01",
    headline: "Ingest",
    body: "Sui GraphQL fetches package data, modules, and upgrade history. MVR reverse-resolves the address into a human-readable name and linked source repo.",
  },
  {
    icon: "/S2.png",
    illustration: "/Step2.png",
    label: "PHASE 02",
    headline: "Audit",
    body: "LanceDB semantic recall finds similar vulnerability patterns from 52 known exploits. 65 deterministic rules scan for capability leakage, ownership bugs, hot-potato misuse, unsafe upgrades, missing signer checks, and overflow risk — benchmarked against OpenZeppelin's audited math library.",
  },
  {
    icon: "/S3.png",
    illustration: "/Step3.png",
    label: "PHASE 03",
    headline: "Encrypt & store",
    body: "Findings are structured and stored back to the LanceDB corpus for future recall. Seal encrypts the full report — the contract owner gets a private draft first, before anyone else.",
  },
  {
    icon: "/S4.png",
    illustration: "/Step4.png",
    label: "PHASE 04",
    headline: "Link on-chain",
    body: "The report is bundled via Walrus Quilt and uploaded as a permanent, tamper-evident blob. MVR's set_metadata() attaches the blob ID to the package — the audit is now part of its permanent on-chain identity.",
  },
];

export function HowItWorks() {
  const [isDesktopPinned, setIsDesktopPinned] = useState(false);
  const [progress, setProgress] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const widthQuery = window.matchMedia("(min-width: 768px)");
    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

    function update() {
      setIsDesktopPinned(widthQuery.matches && !motionQuery.matches);
    }

    update();
    widthQuery.addEventListener("change", update);
    motionQuery.addEventListener("change", update);
    return () => {
      widthQuery.removeEventListener("change", update);
      motionQuery.removeEventListener("change", update);
    };
  }, []);

  useEffect(() => {
    if (!isDesktopPinned) return;
    const container = containerRef.current;
    if (!container) return;

    let rafId = 0;

    function update() {
      rafId = 0;
      const rect = container!.getBoundingClientRect();
      const total = rect.height - window.innerHeight;
      const passed = -rect.top;
      setProgress(total > 0 ? Math.min(1, Math.max(0, passed / total)) : 0);
    }

    function onScroll() {
      if (!rafId) rafId = requestAnimationFrame(update);
    }

    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [isDesktopPinned]);

  const activeIndex = Math.min(PHASES.length - 1, Math.floor(progress * PHASES.length));

  if (!isDesktopPinned) {
    return (
      <section className="relative w-full bg-black px-6 pt-8 sm:pt-10 pb-20 sm:pb-24">
        <SectionHeading />
        <div className="flex flex-col gap-8 sm:gap-10">
          {PHASES.map((phase, i) => (
            <Card key={phase.label} phase={phase} index={i} state="active" />
          ))}
        </div>
      </section>
    );
  }

  return (
    <section className="relative w-full bg-black px-6 pt-8 sm:pt-10">
      <SectionHeading />

      <div ref={containerRef} className="relative" style={{ height: "400vh" }}>
        <div className="sticky top-0 h-screen overflow-hidden bg-black px-6 flex items-center">
          <div className="relative w-full max-w-[1100px] mx-auto h-[640px] sm:h-[600px]">
            {PHASES.map((phase, i) => {
              const state = i === activeIndex ? "active" : i < activeIndex ? "exited" : "pending";
              return <Card key={phase.label} phase={phase} index={i} state={state} pinned />;
            })}
          </div>

          <div className="absolute bottom-10 left-1/2 -translate-x-1/2 flex items-center gap-3">
            {PHASES.map((_, i) => (
              <span
                key={i}
                className="w-2.5 h-2.5 rounded-full transition-all duration-300"
                style={{
                  backgroundColor: i === activeIndex ? "var(--brand-blue)" : "rgba(255,255,255,0.14)",
                  transform: i === activeIndex ? "scale(1.2)" : "scale(1)",
                }}
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function SectionHeading() {
  return (
    <div className="max-w-[1100px] mx-auto text-center flex flex-col items-center mb-6 sm:mb-8">
      <h2 className="font-display font-bold text-[40px] sm:text-[64px] md:text-[78px] leading-[0.98] tracking-[-0.03em] text-white">
        From blind spot
        <br />
        to bulletproof.
      </h2>
    </div>
  );
}

type CardState = "active" | "exited" | "pending";

function Card({
  phase,
  index,
  state,
  pinned = false,
}: {
  phase: (typeof PHASES)[number];
  index: number;
  state: CardState;
  pinned?: boolean;
}) {
  const reverseDesktop = index % 2 === 1;

  const transformStyle =
    state === "active"
      ? "translateY(0)"
      : state === "exited"
        ? "translateY(-40px)"
        : "translateY(110px)";

  return (
    <div
      className={pinned ? "absolute inset-0" : "relative"}
      style={
        pinned
          ? {
              opacity: state === "active" ? 1 : 0,
              transform: transformStyle,
              transition: "opacity 450ms ease-out, transform 450ms ease-out",
              pointerEvents: state === "active" ? "auto" : "none",
            }
          : undefined
      }
    >
      <div
        className={`flex flex-col ${reverseDesktop ? "md:flex-row-reverse" : "md:flex-row"} items-center gap-12 md:gap-14 lg:gap-16 rounded-[24px] p-6 sm:p-8 md:p-12 lg:p-16 h-full`}
        style={{
          background: "rgba(161,200,255,0.10)",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          boxShadow: "0 8px 40px rgba(0,0,0,0.4)",
        }}
      >
        <div className="w-full md:w-[45%] flex flex-col">
          <img src={phase.icon} alt="" className="w-10 h-10 sm:w-12 sm:h-12 object-contain mb-6" />
          <div className="font-mono-plex text-[12px] tracking-[0.08em] uppercase text-[var(--text-tertiary)] mb-3">
            {phase.label}
          </div>
          <h3 className="font-display font-bold text-[28px] sm:text-[36px] leading-[1.1] text-[var(--text-primary)] mb-4">
            {phase.headline}
          </h3>
          <p className="text-[15px] sm:text-[16px] leading-[1.6] text-[var(--text-secondary)] max-w-[420px]">
            {phase.body}
          </p>
        </div>

        <div className="w-full md:w-[55%] h-[220px] sm:h-[280px] md:h-[320px] lg:h-[380px] rounded-[18px] overflow-hidden">
          <img src={phase.illustration} alt="" className="w-full h-full object-contain" />
        </div>
      </div>
    </div>
  );
}
