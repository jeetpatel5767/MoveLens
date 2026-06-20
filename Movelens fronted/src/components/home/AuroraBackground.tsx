"use client";

import { useEffect, useState } from "react";

const FADE_DISTANCE = 500;
const MIN_OPACITY = 0.3;

export function AuroraBackground() {
  const [opacity, setOpacity] = useState(1);

  useEffect(() => {
    function updateOpacity() {
      const scrolled = Math.min(window.scrollY, FADE_DISTANCE);
      const ratio = scrolled / FADE_DISTANCE;
      setOpacity(1 - ratio * (1 - MIN_OPACITY));
    }

    updateOpacity();
    window.addEventListener("scroll", updateOpacity, { passive: true });
    return () => window.removeEventListener("scroll", updateOpacity);
  }, []);

  return (
    <div
      className="absolute inset-x-0 top-[120px] sm:top-[160px] md:top-[200px] w-full pointer-events-none select-none z-0 transition-opacity duration-300 ease-out"
      style={{ opacity }}
    >
      <img
        src="/Aurora.png"
        alt="Aurora Wave Background"
        className="w-full h-auto opacity-90"
      />

      <div className="absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-black to-transparent pointer-events-none" />
      <div className="absolute inset-x-0 bottom-0 h-[450px] bg-gradient-to-t from-black via-black/30 to-transparent pointer-events-none" />

      <div className="absolute inset-0 bg-grain opacity-[0.06] mix-blend-overlay pointer-events-none" />
    </div>
  );
}
