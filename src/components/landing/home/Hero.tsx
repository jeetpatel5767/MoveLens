import type { ReactNode } from "react";
import { AssetMarquee } from "@/components/landing/home/AssetMarquee";
import { AuroraBackground } from "@/components/landing/home/AuroraBackground";
import { MascotImage } from "@/components/landing/home/MascotImage";

export function Hero({ children }: { children?: ReactNode }) {
  return (
    <section className="relative w-full z-10 flex-1">
      <div className="relative min-h-[950px] w-full flex flex-col items-center justify-start pt-32 sm:pt-40 md:pt-40 px-6">
        <AuroraBackground />

        <div className="max-w-[1200px] w-full mx-auto text-center flex flex-col items-center relative z-20">
          <h1 className="font-display font-bold text-[40px] sm:text-[100px] md:text-[116px] lg:text-[128px] leading-[0.9] tracking-[-0.035em] text-white mb-6 max-w-5xl">
            A flashlight for Move contracts.
          </h1>

          <p className="text-[15px] sm:text-[19px] md:text-[21px] leading-[1.6] text-[var(--text-secondary)] max-w-3xl mb-10 font-sans-switzer font-extralight">
            <span className="text-white font-light">MoveLens</span> is a{" "}
            <span className="text-white font-light">verifiable security auditor</span> for Sui Move.
            Get your <span className="text-white font-light">encrypted vulnerability reports</span>{" "}
            stored permanently on <span className="text-white font-light">Walrus</span>.
          </p>

          <div className="w-full flex justify-center mb-6">{children}</div>
        </div>

        <div className="absolute bottom-0 left-0 right-0 w-full flex flex-col items-center justify-end z-10 h-[480px]">
          <div className="relative w-full max-w-[840px] flex justify-center z-10 translate-y-[25%] select-none pointer-events-none">
            <MascotImage />
          </div>
        </div>
      </div>

      <div className="relative z-30 -mt-14 sm:-mt-16">
        <AssetMarquee />
      </div>

      <div className="relative z-40 w-full mt-8 sm:mt-10 md:mt-12 bg-white/[0.005] backdrop-blur-sm backdrop-saturate-150 border-t border-white/[0.06] rounded-t-[40px] rounded-b-none px-6 pt-20 sm:pt-24 md:pt-28 pb-8 sm:pb-10 md:pb-12 shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_-20px_60px_rgba(0,0,0,0.35)]">
        <p className="max-w-4xl mx-auto text-center font-display font-light text-[26px] sm:text-[48px] md:text-[58px] leading-[1.1] tracking-[-0.03em] text-white">
          &ldquo;Ship fast, break less.
          <br />
          Code clean, no guess.
          <br />
          MoveLens reads the mess.&rdquo;
        </p>

        <div className="w-full flex justify-center mt-10 sm:mt-12">
          <a
            href="/app"
            className="bg-[var(--brand-lavender)] hover:bg-[var(--brand-lavender-hover)] text-[var(--ink)] px-8 py-3.5 rounded-full text-sm font-semibold tracking-wide transition-all flex items-center gap-2 cursor-pointer shadow-lg"
          >
            Run an audit <span className="opacity-80 text-xs">↗</span>
          </a>
        </div>
      </div>
    </section>
  );
}
