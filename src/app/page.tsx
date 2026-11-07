import type { Metadata } from "next";
import { LANDING_PLANS, LANDING_SEO } from "@/content/landing";
import { getPublicPlans } from "@/lib/plans-server";
import { ClosingCta, LandingFaq, LandingFooter } from "@/components/landing/landing-closing";
import { LandingHeader } from "@/components/landing/landing-header";
import { LandingPricing } from "@/components/landing/landing-pricing";
import { Hero } from "@/components/landing/hero";
import { NicheMarquee } from "@/components/landing/niche-marquee";
import { RevealObserver } from "@/components/landing/reveal-observer";
import { ImplicationSection, NeedSection, ProblemSection, SolutionSection } from "@/components/landing/spin-sections";
import { lpHeadTitle, lpKicker, lpSection, lpWrap } from "@/components/landing/styles";
import { Testimonials } from "@/components/landing/testimonials";

// Landing page do produto (protótipo aprovado: docs/landing/prototipo-v5.html).
// Copy em src/content/landing.ts; preços da tabela plans (migrations 28a/28b).

export const metadata: Metadata = {
  title: LANDING_SEO.title,
  description: LANDING_SEO.description,
  alternates: { canonical: "/" },
};

// Cache de 1 hora: só lê dados públicos (plans) com o cliente sem cookies.
export const revalidate = 3600;

export default async function Home() {
  const plans = await getPublicPlans();

  return (
    <>
      <LandingHeader />
      <main className="overflow-x-clip">
        <Hero />
        <NicheMarquee />
        <ProblemSection />
        <ImplicationSection />
        <NeedSection />
        <SolutionSection />
        <Testimonials />

        <section id="planos" className={`${lpSection} scroll-mt-[72px] bg-secondary`}>
          <div className={lpWrap}>
            <div className="lp-reveal mx-auto mb-12 max-w-[680px] text-center">
              <span className={lpKicker}>{LANDING_PLANS.kicker}</span>
              <h2 className={lpHeadTitle}>{LANDING_PLANS.title}</h2>
            </div>
            <LandingPricing plans={plans} />
          </div>
        </section>

        <LandingFaq />
        <ClosingCta />
      </main>
      <LandingFooter />
      <RevealObserver />
    </>
  );
}
