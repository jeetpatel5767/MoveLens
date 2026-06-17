import { ProblemSolutionTabs } from "@/components/landing/solution/ProblemSolutionTabs";

export function Solution() {
  return (
    <section className="relative w-full bg-black px-6 pt-8 sm:pt-10 md:pt-12 pb-12 sm:pb-16 md:pb-20">
      <div className="max-w-[1100px] mx-auto text-center flex flex-col items-center">
        <h2 className="font-display font-bold text-[40px] sm:text-[64px] md:text-[78px] leading-[0.98] tracking-[-0.03em] text-white">
          See straight through
          <br />
          every Move package.
        </h2>
      </div>

      <ProblemSolutionTabs />
    </section>
  );
}
