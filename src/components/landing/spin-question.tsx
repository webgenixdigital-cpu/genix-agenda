import type { Marked } from "@/content/landing";

/**
 * Pergunta SPIN em destaque: selo redondo com a letra, título grande em itálico
 * e a palavra-chave grifada em dourado. `dark` = sobre fundo escuro.
 */
export function SpinQuestion({
  letter,
  tag,
  title,
  text,
  dark,
  className = "mb-12 md:mb-16",
}: {
  letter: string;
  tag: string;
  title: Marked;
  text?: string;
  dark?: boolean;
  className?: string;
}) {
  return (
    <div className={`lp-reveal mx-auto max-w-[860px] text-center ${className}`}>
      <p
        className={`mb-6 inline-flex items-center gap-2.5 text-xs font-bold uppercase tracking-[0.14em] ${
          dark ? "text-[#F2C078]" : "text-primary"
        }`}
      >
        <span
          className={`grid h-8 w-8 place-items-center rounded-full text-sm tracking-normal ${
            dark ? "bg-[#F2C078] text-foreground" : "bg-primary text-primary-foreground"
          }`}
          aria-hidden
        >
          {letter}
        </span>
        {tag}
      </p>
      <h2 className="text-[length:clamp(32px,5vw,56px)] font-semibold italic leading-[1.12]">
        {title[0]}
        <mark className="lp-mark">{title[1]}</mark>
        {title[2]}
      </h2>
      {text && (
        <p className={`mx-auto mt-6 max-w-[36em] text-[19px] leading-relaxed ${dark ? "text-stone-300" : "text-muted-foreground"}`}>
          {text}
        </p>
      )}
    </div>
  );
}
