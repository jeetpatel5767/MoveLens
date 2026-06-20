import { Header } from "@/components/landing/layout/Header";
import { Hero } from "@/components/landing/home/Hero";
import { Solution } from "@/components/landing/solution/Solution";
import { HowItWorks } from "@/components/landing/howitworks/HowItWorks";
import { LiveDemoHero } from "@/components/landing/livedemo/LiveDemoHero";
import { SampleReport } from "@/components/landing/samplereport/SampleReport";
import { Differentiators } from "@/components/landing/differentiators/Differentiators";
import { TrustVerification } from "@/components/landing/trust/TrustVerification";
import { CTA } from "@/components/landing/cta/CTA";
import { Footer } from "@/components/landing/footer/Footer";

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-black text-[var(--text-primary)] font-sans-switzer relative flex flex-col justify-between">
      <Header />
      <Hero>
        <a
          href="/app"
          className="border border-white/20 hover:border-white/40 bg-black/30 hover:bg-black/50 px-8 py-3.5 rounded-full text-sm font-semibold tracking-wide text-white transition-all inline-flex items-center gap-2 cursor-pointer backdrop-blur-md shadow-lg"
        >
          Audit package <span className="opacity-80 text-xs">↗</span>
        </a>
      </Hero>
      <div id="solution"><Solution /></div>
      <div id="how-it-works"><HowItWorks /></div>
      <div id="demo"><LiveDemoHero /></div>
      <SampleReport />
      <div id="differentiators"><Differentiators /></div>
      <div id="trust"><TrustVerification /></div>
      <CTA />
      <Footer />
    </div>
  );
}
