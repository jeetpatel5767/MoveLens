import { Header } from "src/components/layout/Header";
import { Hero } from "src/components/home/Hero";
import { Solution } from "src/components/solution/Solution";
import { HowItWorks } from "src/components/howitworks/HowItWorks";
import { SampleReport } from "src/components/samplereport/SampleReport";
import { Differentiators } from "src/components/differentiators/Differentiators";
import { TrustVerification } from "src/components/trust/TrustVerification";
import { LiveDemoHero } from "src/components/livedemo/LiveDemoHero";
import { CTA } from "src/components/cta/CTA";
import { Footer } from "src/components/footer/Footer";

export default function Home() {
  return (
    <div className="min-h-screen bg-black text-[var(--text-primary)] font-sans-switzer relative flex flex-col justify-between">
      <Header />
      <Hero>
        <button className="border border-white/20 hover:border-white/40 bg-black/30 hover:bg-black/50 px-8 py-3.5 rounded-full text-sm font-semibold tracking-wide text-white transition-all flex items-center gap-2 cursor-pointer backdrop-blur-md shadow-lg">
          Audit package <span className="opacity-80 text-xs">↗</span>
        </button>
      </Hero>
      <Solution />
      <HowItWorks />
      <LiveDemoHero />
      <SampleReport />
      <Differentiators />
      <TrustVerification />
      <CTA />
      <Footer />
    </div>
  );
}
