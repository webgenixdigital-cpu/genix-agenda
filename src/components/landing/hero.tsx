import Image from "next/image";
import { LANDING_HERO } from "@/content/landing";
import { HeroSignupForm } from "./hero-signup-form";
import { PhoneMock } from "./phone-mock";
import { lpKicker, lpWrap } from "./styles";

/** Foto de capa opcional (public/brand/capa-hero.webp|jpg), conferida no build pelo next.config.mjs */
const HERO_IMAGE = process.env.LANDING_HERO_IMAGE || "";

/** Lista com ✓ das microgarantias (hero e fechamento) */
export function MicroList({ items, className = "", checkClassName = "text-primary" }: { items: string[]; className?: string; checkClassName?: string }) {
  return (
    <ul className={`mt-4 flex flex-wrap justify-center gap-x-6 gap-y-1 text-sm ${className}`}>
      {items.map((m) => (
        <li key={m}>
          <span className={`font-bold ${checkClassName}`} aria-hidden>✓ </span>
          {m}
        </li>
      ))}
    </ul>
  );
}

/**
 * Hero (Situação), fundo escuro com foto opcional + gradiente por cima.
 * Desktop: texto à esquerda e celular à direita; até 899 px, uma coluna centralizada.
 */
export function Hero() {
  const h = LANDING_HERO;
  return (
    <section className="relative flex items-center overflow-hidden bg-foreground py-24 text-[#f3ece4] md:min-h-[min(92vh,860px)] md:py-32">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_75%_30%,#5a3519,#1c1917_70%)]" aria-hidden>
        {HERO_IMAGE && <Image src={HERO_IMAGE} alt="" fill priority sizes="100vw" className="object-cover" />}
        <div className="absolute inset-0 bg-[linear-gradient(100deg,rgba(28,25,23,0.94)_0%,rgba(28,25,23,0.82)_45%,rgba(28,25,23,0.45)_100%)]" />
      </div>

      <div className={`${lpWrap} relative grid items-center gap-12 text-center min-[900px]:grid-cols-[1.05fr_0.95fr] min-[900px]:gap-16 min-[900px]:text-left`}>
        <div>
          <span className={`${lpKicker} !text-[#F2C078]`}>{h.kicker}</span>
          <h1 className="font-bold text-[length:clamp(36px,5.4vw,60px)] leading-[1.15] tracking-[-0.01em] text-white">
            {h.title[0]}
            <em className="text-[#F2C078]">{h.title[1]}</em>
          </h1>
          <p className="mx-auto mb-8 mt-6 max-w-[30em] text-[19px] leading-relaxed text-[#d8cdc1] min-[900px]:mx-0">{h.lead}</p>
          <HeroSignupForm />
          <MicroList items={h.micro} className="text-[#cbbfb3] min-[900px]:justify-start" checkClassName="text-[#F2C078]" />
        </div>
        <PhoneMock />
      </div>
    </section>
  );
}
