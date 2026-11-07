import Link from "next/link";
import { BrandLogo } from "@/components/brand-logo";
import { LANDING_CLOSING, LANDING_FAQ, LANDING_FOOTER, LANDING_NAV } from "@/content/landing";
import { LEGAL } from "@/lib/legal";
import { MicroList } from "./hero";
import { SpinQuestion } from "./spin-question";
import { lpBtnGold, lpHeadTitle, lpKicker, lpSection, lpWrap } from "./styles";

/** Perguntas frequentes (acordeão nativo, alinhado à esquerda) */
export function LandingFaq() {
  const f = LANDING_FAQ;
  return (
    <section id="duvidas" className={`${lpSection} scroll-mt-[72px]`}>
      <div className={lpWrap}>
        <div className="lp-reveal mx-auto mb-12 max-w-[680px] text-center">
          <span className={lpKicker}>{f.kicker}</span>
          <h2 className={lpHeadTitle}>{f.title}</h2>
        </div>
        <div className="mx-auto max-w-[760px]">
          {f.items.map((item, i) => (
            <details key={item.q} className="group border-b py-4">
              <summary
                className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-4 text-lg font-bold [&::-webkit-details-marker]:hidden"
                data-testid={`faq-pergunta-${i + 1}`}
              >
                {item.q}
                <span className="shrink-0 text-2xl leading-none text-primary transition-transform group-open:rotate-45" aria-hidden>
                  +
                </span>
              </summary>
              <p className="mt-2 text-muted-foreground">{item.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

/** Fechamento (fundo escuro): pergunta final + chamada */
export function ClosingCta() {
  const c = LANDING_CLOSING;
  return (
    <section className={`${lpSection} bg-foreground text-center text-[#f3ece4]`}>
      <div className={lpWrap}>
        <SpinQuestion letter={c.letter} tag={c.tag} title={c.title} dark className="mb-8" />
        <Link href={LANDING_NAV.signup.href} className={lpBtnGold} data-testid="btn-final-teste">
          {c.cta}
        </Link>
        <MicroList items={c.micro} className="text-stone-300" />
      </div>
    </section>
  );
}

/** Rodapé: logo + © + links discretos (Termos, Privacidade, Encontrar um espaço, Contato) */
export function LandingFooter() {
  const f = LANDING_FOOTER;
  const link = "inline-flex min-h-11 items-center hover:text-foreground";
  return (
    <footer className="border-t py-12 text-center">
      <div className={`${lpWrap} flex flex-col items-center gap-4`}>
        <BrandLogo className="h-[30px]" />
        <p className="text-sm text-muted-foreground">{f.copyright(new Date().getFullYear())}</p>
        <nav className="flex flex-wrap justify-center gap-x-5 text-xs text-muted-foreground" aria-label={f.ariaLabel}>
          <Link href={LANDING_NAV.findSpace.href} className={link} data-testid="link-rodape-espacos">
            {LANDING_NAV.findSpace.label}
          </Link>
          {f.links.map((l) => (
            <Link key={l.href} href={l.href} className={link} data-testid={l.testid}>
              {l.label}
            </Link>
          ))}
          <a href={`mailto:${LEGAL.emailContato}`} className={link} data-testid="link-rodape-contato">
            {f.contact}
          </a>
        </nav>
      </div>
    </footer>
  );
}
