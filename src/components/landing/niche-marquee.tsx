import { LANDING_NICHES } from "@/content/landing";

/** Faixa de nichos deslizando (a lista é repetida para o laço não ter emenda; a cópia fica oculta do leitor de tela) */
export function NicheMarquee() {
  const row = (hidden: boolean) =>
    LANDING_NICHES.map((n) => (
      <li key={`${n}-${hidden}`} className="mr-12 flex items-center" aria-hidden={hidden || undefined}>
        <span className="mr-12 text-[#C47B47]" aria-hidden>✦</span>
        {n}
      </li>
    ));

  return (
    <div className="overflow-hidden border-y py-6">
      <ul className="lp-marquee flex w-max font-heading text-xl text-muted-foreground">
        {row(false)}
        {row(true)}
      </ul>
    </div>
  );
}
