const MARQUEE_ITEMS = [
  { src: "/seal.png", alt: "Seal" },
  { src: "/sui.png", alt: "Sui" },
  { src: "/wal.png", alt: "Walrus" },
];

const LOOP_SET = [...MARQUEE_ITEMS, ...MARQUEE_ITEMS, ...MARQUEE_ITEMS];

export function AssetMarquee() {
  return (
    <div className="w-full overflow-x-hidden overflow-y-visible h-22 [mask-image:linear-gradient(90deg,transparent,black_8%,black_92%,transparent)]">
      <div className="flex w-max animate-marquee">
        {[0, 1].map((rep) => (
          <div key={rep} className="flex items-center mt-4">
            {LOOP_SET.map((item, i) => (
              <div
                key={`${rep}-${i}`}
                className="flex items-center justify-center mx-3 px-7 py-3 rounded-full border border-white/10 bg-white/10 shadow-[0_8px_24px_rgba(0,0,0,0.25)]"
              >
                <img
                  src={item.src}
                  alt={item.alt}
                  className="h-6 w-auto object-contain opacity-90"
                  style={{ filter: "brightness(0) invert(1)" }}
                />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
