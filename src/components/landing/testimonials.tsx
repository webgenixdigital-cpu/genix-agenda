import { LANDING_PROOF } from "@/content/landing";
import { lpCard, lpHeadTitle, lpKicker, lpSection, lpWrap } from "./styles";

function Stars({ label }: { label?: string }) {
  return (
    <span className="tracking-[2px] text-[#E3A92B]" role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      ★★★★★
    </span>
  );
}

/** Depoimentos reais do Google + selo 5,0 com link para o perfil */
export function Testimonials() {
  const p = LANDING_PROOF;
  return (
    <section className={lpSection}>
      <div className={lpWrap}>
        <div className="lp-reveal mx-auto mb-12 max-w-[680px] text-center">
          <span className={lpKicker}>{p.kicker}</span>
          <h2 className={lpHeadTitle}>{p.title}</h2>
          <a
            href={p.badge.href}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={p.badge.ariaLabel}
            className="mt-6 inline-flex min-h-11 items-center gap-2.5 rounded-full border bg-white px-[18px] py-2 text-[15px] text-foreground hover:border-primary"
            data-testid="link-avaliacoes-google"
          >
            <b className="font-heading text-xl">{p.badge.score}</b>
            <Stars />
            <span>{p.badge.label}</span>
          </a>
        </div>

        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {p.reviews.map((r) => (
            <figure key={r.name} className={`lp-reveal ${lpCard}`}>
              <p className="mb-4 text-base">
                <Stars label={p.starsLabel} />
              </p>
              <blockquote className="font-heading text-lg italic leading-[1.4] text-foreground">{r.text}</blockquote>
              <figcaption className="mt-6 flex items-center gap-3 text-sm">
                <span
                  className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-gradient-to-br from-[#F2C078] to-primary font-bold text-white"
                  aria-hidden
                >
                  {r.name.charAt(0)}
                </span>
                <span>
                  <b className="block">{r.name}</b>
                  <span className="text-muted-foreground">{p.source}</span>
                </span>
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}
