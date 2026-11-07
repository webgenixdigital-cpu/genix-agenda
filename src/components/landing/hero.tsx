import { LANDING_HERO } from "@/content/landing";
import { HeroSignupForm } from "./hero-signup-form";
import { PhoneMock } from "./phone-mock";
import { lpKicker, lpWrap } from "./styles";

/** Lista com ✓ das microgarantias (hero e fechamento) */
export function MicroList({ items, className = "" }: { items: string[]; className?: string }) {
  return (
    <ul className={`mt-4 flex flex-wrap justify-center gap-x-6 gap-y-1 text-sm ${className}`}>
      {items.map((m) => (
        <li key={m}>
          <span className="font-bold text-primary" aria-hidden>✓ </span>
          {m}
        </li>
      ))}
    </ul>
  );
}

/** Hero (Situação): desktop texto à esquerda e celular à direita; até 899 px, uma coluna centralizada */
export function Hero() {
  const h = LANDING_HERO;
  return (
    <section className="pb-16 pt-12 md:pb-24 md:pt-16">
      <div className={`${lpWrap} grid items-center gap-12 text-center min-[900px]:grid-cols-[1.05fr_0.95fr] min-[900px]:gap-16 min-[900px]:text-left`}>
        <div>
          <span className={lpKicker}>{h.kicker}</span>
          <h1 className="font-bold text-[length:clamp(36px,5.4vw,60px)] leading-[1.15] tracking-[-0.01em]">
            {h.title[0]}
            <em className="text-primary">{h.title[1]}</em>
          </h1>
          <p className="mx-auto mb-8 mt-6 max-w-[30em] text-[19px] leading-relaxed text-muted-foreground min-[900px]:mx-0">{h.lead}</p>
          <HeroSignupForm />
          <MicroList items={h.micro} className="text-muted-foreground min-[900px]:justify-start" />
        </div>
        <PhoneMock />
      </div>
    </section>
  );
}
