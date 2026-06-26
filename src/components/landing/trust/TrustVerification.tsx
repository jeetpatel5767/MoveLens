const CARDS = [
  { name: "Seal",   img: "/seal.png", description: "Encrypts the report. The owner gets the private draft first." },
  { name: "Walrus", img: "/wal.png",  description: "Stores it permanently — tamper-evident and content-addressed." },
  { name: "MVR",    img: null,        description: "Links the report to your package's on-chain identity permanently." },
  { name: "Sui",    img: "/sui.png",  description: "The chain everything lives on — public and outside MoveLens's control." },
];

function TrustCard({ card }: { card: (typeof CARDS)[number] }) {
  return (
    <div
      className="relative rounded-[24px] flex flex-col justify-between h-full"
      style={{ background: "rgba(255,255,255,0.04)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)", boxShadow: "0 8px 40px rgba(0,0,0,0.4)", padding: "24px 28px 20px", minHeight: 160 }}
    >
      <div className="flex items-center justify-center flex-1">
        {card.img ? (
          <img src={card.img} alt={card.name} className="w-32 h-32 object-contain" style={{ filter: "brightness(0) invert(1)" }} />
        ) : (
          <div className="font-display font-extrabold text-[36px] leading-none text-white tracking-[-0.02em]">MVR</div>
        )}
      </div>
    </div>
  );
}

export function TrustVerification() {
  return (
    <section className="relative w-full bg-black px-6 pt-8 sm:pt-10 pb-16 sm:pb-20">
      <div className="max-w-[1200px] mx-auto">
        <div className="flex flex-col lg:flex-row lg:items-center gap-12 lg:gap-16">
          <div className="lg:w-[32%] lg:flex-shrink-0">
            <h2 className="font-display font-bold text-[40px] sm:text-[56px] md:text-[68px] leading-[0.95] tracking-[-0.03em] text-white mb-6">
              Every layer,
              <br />
              accounted for.
            </h2>
            <p className="text-[16px] sm:text-[17px] leading-[1.65] text-[var(--text-secondary)] font-sans-switzer font-extralight max-w-[400px]">
              Your report doesn&rsquo;t just get generated — it gets sealed, stored, and
              stamped onto the chain, in that order.
            </p>
          </div>

          <div className="flex-1 flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-4">
              <TrustCard card={CARDS[0]} />
              <TrustCard card={CARDS[1]} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <TrustCard card={CARDS[2]} />
              <TrustCard card={CARDS[3]} />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
