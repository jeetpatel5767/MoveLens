"use client";

import { useEffect, useRef, useState } from "react";

const PROBLEMS = [
  {
    heading: "Hidden ownership bugs",
    description:
      "Move's object-ownership model is new — capability leakage and hot-potato misuse don't surface in normal testing.",
    icon: "/P1.png",
  },
  {
    heading: "Audits that don't scale",
    description: "Manual audits take weeks and cost thousands — most solo builders ship unaudited.",
    icon: "/P2.png",
  },
  {
    heading: "Million-dollar overflow bugs",
    description:
      "Integer overflow and unsafe upgrade bugs have already cost real protocols millions (Cetus-class exploits).",
    icon: "/P3.png",
  },
  {
    heading: "Trust without proof",
    description: "Even when audits happen, there's no permanent, verifiable record — trust is just a claim.",
    icon: "/P4.png",
  },
];

const SOLUTIONS = [
  {
    heading: "AI that reads every line",
    description:
      "AI agents check capability leakage, ownership bugs, hot-potato misuse, unsafe upgrades, signer checks, and overflow risk — no audit team required.",
  },
  {
    heading: "Audits in minutes",
    description: "Paste an address or upload source — a structured report comes back in under 2 minutes.",
  },
  {
    heading: "Battle-tested benchmarks",
    description:
      "Every contract is benchmarked against OpenZeppelin's audited math library, with a priority Cetus-class overflow check.",
  },
  {
    heading: "Proof that lasts forever",
    description:
      "The report is signed, encrypted, stored permanently on Walrus, and linked on-chain via MVR — the audit becomes part of the contract's permanent identity.",
  },
];

type Tab = "problem" | "solution";

export function ProblemSolutionTabs() {
  const [tab, setTab] = useState<Tab>("problem");
  const items = tab === "problem" ? PROBLEMS : SOLUTIONS;

  return (
    <div className="w-full mt-12 sm:mt-16">
      <div className="flex justify-center mb-10">
        <div className="inline-flex items-center gap-1.5 p-1.5 rounded-full border border-white/10 bg-white/[0.03] backdrop-blur-xl shadow-[0_16px_40px_rgba(0,0,0,0.45)]">
          <button
            onClick={() => setTab("problem")}
            className={`px-5 py-2.5 rounded-full text-[13px] font-medium transition-all cursor-pointer ${tab === "problem"
              ? "bg-white text-[var(--ink)]"
              : "bg-white/5 text-[var(--text-secondary)] hover:text-white"
              }`}
          >
            Problems
          </button>
          <button
            onClick={() => setTab("solution")}
            className={`px-5 py-2.5 rounded-full text-[13px] font-medium transition-all cursor-pointer ${tab === "solution"
              ? "bg-white text-[var(--ink)]"
              : "bg-white/5 text-[var(--text-secondary)] hover:text-white"
              }`}
          >
            Solution
          </button>
        </div>
      </div>

      <CardStack key={tab} items={items} />
    </div>
  );
}

const REPEAT = 3;

function CardStack({
  items,
}: {
  items: { heading: string; description: string; icon?: string }[];
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);
  const blockSize = items.length;
  const loop = Array.from({ length: REPEAT }, () => items).flat();

  // Start centered on the 2nd card, in the middle repeated block so there's room to scroll both ways.
  // Use scrollLeft directly instead of scrollIntoView — scrollIntoView scrolls the whole page.
  useEffect(() => {
    const scrollEl = scrollRef.current;
    const startEl = itemRefs.current[blockSize + 1];
    if (!scrollEl || !startEl) return;
    const itemLeft = startEl.offsetLeft;
    const itemWidth = startEl.offsetWidth;
    scrollEl.scrollLeft = itemLeft - scrollEl.clientWidth / 2 + itemWidth / 2;
  }, [blockSize]);

  // Cache the block width once instead of re-measuring on every scroll/drag tick —
  // repeated offsetLeft reads were forcing layout reflows and causing the lag.
  const blockWidthRef = useRef(0);
  useEffect(() => {
    function measure() {
      const first = itemRefs.current[0];
      const nextBlockFirst = itemRefs.current[blockSize];
      blockWidthRef.current = first && nextBlockFirst ? nextBlockFirst.offsetLeft - first.offsetLeft : 0;
    }
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [blockSize]);

  // Infinite loop: once the scroll nears either end of the repeated set, silently jump back
  // by exactly one block-width — since every block is identical, the jump is invisible.
  // This is the only automatic scroll adjustment; nothing auto-centers or keeps moving
  // after you stop dragging.
  useEffect(() => {
    const scrollEl = scrollRef.current;
    if (!scrollEl) return;

    function handleScroll() {
      const el = scrollRef.current;
      const blockWidth = blockWidthRef.current;
      if (!el || !blockWidth) return;

      if (el.scrollLeft < blockWidth * 0.5) {
        el.scrollLeft += blockWidth;
      } else if (el.scrollLeft > blockWidth * (REPEAT - 1.5)) {
        el.scrollLeft -= blockWidth;
      }
    }

    scrollEl.addEventListener("scroll", handleScroll, { passive: true });
    return () => scrollEl.removeEventListener("scroll", handleScroll);
  }, []);

  // Click-and-drag scrolling with the mouse, like a "hand tool" pan. While
  // dragging we only move a CSS transform (compositor-only, no layout cost)
  // instead of writing to scrollLeft every frame — that's what was causing
  // the lag, since scrollLeft writes force a synchronous layout each time.
  // The transform is "baked" into a real scrollLeft in one instant step on
  // release, so it stays in sync with native wheel/trackpad scrolling.
  const trackRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    const track = trackRef.current;
    if (!el || !track) return;

    let isDown = false;
    let startX = 0;
    let startScroll = 0;
    let dx = 0;
    let rafId = 0;

    function render() {
      rafId = 0;
      track!.style.transform = `translateX(${dx}px)`;
    }

    function onMouseDown(e: MouseEvent) {
      isDown = true;
      startX = e.pageX;
      startScroll = el!.scrollLeft;
      dx = 0;
      el!.style.cursor = "grabbing";
    }

    function onMouseMove(e: MouseEvent) {
      if (!isDown) return;
      e.preventDefault();
      dx = e.pageX - startX;
      if (!rafId) rafId = requestAnimationFrame(render);
    }

    function endDrag() {
      if (!isDown) return;
      isDown = false;
      if (rafId) cancelAnimationFrame(rafId);
      rafId = 0;
      el!.style.cursor = "grab";
      track!.style.transform = "";
      el!.scrollLeft = startScroll - dx;
      dx = 0;
    }

    el.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", endDrag);

    return () => {
      el.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", endDrag);
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, []);

  return (
    <div className="relative">
      <div className="absolute inset-y-0 left-0 w-32 sm:w-48 md:w-64 bg-gradient-to-r from-black via-black/70 to-transparent z-10 pointer-events-none" />
      <div className="absolute inset-y-0 right-0 w-32 sm:w-48 md:w-64 bg-gradient-to-l from-black via-black/70 to-transparent z-10 pointer-events-none" />

      <div
        ref={scrollRef}
        className="overflow-x-auto px-[calc(50%-260px)] sm:px-[calc(50%-290px)] md:px-[calc(50%-320px)] py-6 cursor-grab select-none [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <div ref={trackRef} className="flex gap-5 will-change-transform">
          {loop.map((item, i) => (
            <div
              key={i}
              ref={(el) => {
                itemRefs.current[i] = el;
              }}
              className="flex-shrink-0 w-[520px] sm:w-[580px] md:w-[640px] min-h-[420px] sm:min-h-[360px] rounded-[48px] bg-[#A1C8FF]/10 px-9 sm:px-11 py-9 sm:py-11 flex flex-col"
            >
              {item.icon ? (
                <img src={item.icon} alt="" className="w-40 h-34 rounded-2xl object-cover mb-10" />
              ) : (
                <div className="w-14 h-14 rounded-2xl bg-white/10 mb-10" />
              )}

              <h3 className="font-display font-normal text-[35px] sm:text-[44px] leading-[1.1] tracking-[-0.02em] text-white mb-5 max-w-[260px] sm:max-w-[300px]">
                {item.heading}
              </h3>
              <p className="text-[20px] sm:text-[18px] leading-[1.65] text-[#8E9294]">
                {item.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
