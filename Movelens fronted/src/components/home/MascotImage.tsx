"use client";

import { useEffect, useState } from "react";

const GROW_DISTANCE = 500;
const MAX_SCALE = 1.08;

export function MascotImage() {
  const [scale, setScale] = useState(1);

  useEffect(() => {
    function updateScale() {
      const scrolled = Math.min(window.scrollY, GROW_DISTANCE);
      const ratio = scrolled / GROW_DISTANCE;
      setScale(1 + ratio * (MAX_SCALE - 1));
    }

    updateScale();
    window.addEventListener("scroll", updateScale, { passive: true });
    return () => window.removeEventListener("scroll", updateScale);
  }, []);

  return (
    <img
      src="/HeroIMG.png"
      alt="MoveLens Mascot Peeking"
      className="w-[90%] sm:w-full h-auto object-contain object-bottom transition-transform duration-300 ease-out"
      style={{ transform: `scale(${scale})` }}
    />
  );
}
