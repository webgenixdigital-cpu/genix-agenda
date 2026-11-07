import {
  LANDING_IMPLICATION,
  LANDING_NEED,
  LANDING_PROBLEM,
  LANDING_SOLUTION,
  LANDING_SPIN_TAG,
} from "@/content/landing";
import { LossCalculator } from "./loss-calculator";
import { SpinQuestion } from "./spin-question";
import { lpCard, lpHeadTitle, lpKicker, lpSection, lpWrap } from "./styles";

/** P — Problema: pergunta + 4 cards de dor */
export function ProblemSection() {
  const p = LANDING_PROBLEM;
  return (
    <section className={lpSection}>
      <div className={lpWrap}>
        <SpinQuestion letter={p.letter} tag={LANDING_SPIN_TAG} title={p.title} text={p.text} />
        <div className="grid gap-6 sm:grid-cols-2">
          {p.pains.map((d) => (
            <div key={d.title} className={`lp-reveal ${lpCard}`}>
              <h3 className="mb-2 text-[21px] font-bold">{d.title}</h3>
              <p className="text-muted-foreground">{d.text}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/** I — Implicação (fundo escuro): pergunta + calculadora de faltas */
export function ImplicationSection() {
  const p = LANDING_IMPLICATION;
  return (
    <section className={`${lpSection} bg-foreground text-[#f3ece4]`}>
      <div className={lpWrap}>
        <SpinQuestion letter={p.letter} tag={LANDING_SPIN_TAG} title={p.title} text={p.text} dark />
        <LossCalculator />
      </div>
    </section>
  );
}

/** N — Necessidade: pergunta + Hoje × Com a Genix Agenda */
export function NeedSection() {
  const p = LANDING_NEED;
  const col = "p-8 md:p-12";
  return (
    <section className={lpSection}>
      <div className={lpWrap}>
        <SpinQuestion letter={p.letter} tag={LANDING_SPIN_TAG} title={p.title} />
        <div className="lp-reveal mx-auto grid max-w-[920px] overflow-hidden rounded-[28px] border text-left sm:grid-cols-2">
          <div className={`${col} bg-secondary`}>
            <h3 className="mb-6 text-2xl font-bold">{p.before.title}</h3>
            <ul className="grid gap-4">
              {p.before.items.map((i) => (
                <li key={i} className="flex gap-3">
                  <span className="font-bold text-[#b4553b]" aria-hidden>✕</span>
                  {i}
                </li>
              ))}
            </ul>
          </div>
          <div className={`${col} bg-white`}>
            <h3 className="mb-6 text-2xl font-bold">{p.after.title}</h3>
            <ul className="grid gap-4">
              {p.after.items.map((i) => (
                <li key={i} className="flex gap-3">
                  <span className="font-bold text-[#2f7a4b]" aria-hidden>✓</span>
                  {i}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

/** Como resolve: 6 cards (dor em marrom + recurso + texto) */
export function SolutionSection() {
  const s = LANDING_SOLUTION;
  return (
    <section id="recursos" className={`${lpSection} scroll-mt-[72px] bg-secondary`}>
      <div className={lpWrap}>
        <div className="lp-reveal mx-auto mb-12 max-w-[680px] text-center">
          <span className={lpKicker}>{s.kicker}</span>
          <h2 className={lpHeadTitle}>{s.title}</h2>
        </div>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {s.items.map((f) => (
            <div key={f.title} className={`lp-reveal ${lpCard}`}>
              <p className="mb-2 text-[13px] font-bold text-primary">{f.from}</p>
              <h3 className="mb-2 text-[21px] font-bold">{f.title}</h3>
              <p className="text-muted-foreground">{f.text}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
