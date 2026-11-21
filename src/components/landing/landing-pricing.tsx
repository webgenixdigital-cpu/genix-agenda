"use client";

import { useState } from "react";
import Link from "next/link";
import { LANDING_NAV, LANDING_PLANS } from "@/content/landing";
import { LAUNCH_TEXT, PLAN_CARDS, PLAN_NAMES } from "@/content/planos";
import { useOfferOpen } from "@/components/use-offer-open";
import { brl } from "@/lib/format";
import { offerEndLabel, offerPrice, type LaunchOffer, type Plan } from "@/lib/plans-public";
import { cn } from "@/lib/utils";
import { lpBtnGold, lpBtnOutline, lpCard } from "./styles";

// Valores sempre da tabela plans (migrations 28a/28b/52), lidos no servidor por getPublicPlans().
// Preço de lançamento (53): launch_offer() no servidor (getLaunchOffer, coupon_prices do cupom),
// escondido no navegador quando o prazo acaba (useOfferOpen).

/** "R$ 187" para valor redondo; "R$ 18,70" com centavos */
const money = (v: number) => (Number.isInteger(v) ? brl(v).replace(/,00$/, "") : brl(v));

function Features({ items, dark }: { items: string[]; dark?: boolean }) {
  return (
    <ul className="mb-8 mt-6 grid flex-1 content-start gap-3">
      {items.map((i) => (
        <li key={i} className={cn("flex gap-2.5 text-[15px]", dark ? "text-stone-300" : "text-foreground")}>
          <span className={cn("font-bold", dark ? "text-[#F2C078]" : "text-primary")} aria-hidden>✓</span>
          {i}
        </li>
      ))}
    </ul>
  );
}

/** Preço grande; com lançamento, o cheio vem riscado em cima */
function Price({ value, per, dark, was }: { value: string; per?: string; dark?: boolean; was?: string }) {
  return (
    <div className="mt-4">
      {was && (
        <p className={cn("mb-1 text-[15px] line-through", dark ? "text-stone-400" : "text-muted-foreground")}>
          <span className="sr-only">{LAUNCH_TEXT.wasLabel(was)}</span>
          <span aria-hidden>{was}</span>
        </p>
      )}
      <p className="whitespace-nowrap font-heading text-[34px] leading-none">
        {value}
        {per && <small className={cn("font-sans text-[15px]", dark ? "text-stone-300" : "text-muted-foreground")}>{per}</small>}
      </p>
    </div>
  );
}

/** Planos: Mensal/Anual; Grátis, Básico, Profissional (destaque escuro) e Equipe (4 colunas a partir de 1100 px) */
export function LandingPricing({ plans, offer: serverOffer = null }: { plans: Plan[]; offer?: LaunchOffer | null }) {
  const t = LANDING_PLANS;
  const offer = useOfferOpen(serverOffer);
  const [cycle, setCycle] = useState<"MONTHLY" | "YEARLY">("MONTHLY");
  const yearly = cycle === "YEARLY";

  const find = (kind: Plan["kind"]) => plans.find((p) => p.kind === kind && p.billing_cycle === cycle);
  const basic = find("basico");
  const pro = find("profissional");
  const team = find("equipe");
  if (!pro || !team) return null;

  const per = yearly ? t.perYear : t.perMonth;
  const proPromo = offerPrice(offer, pro);
  const teamPromo = offerPrice(offer, team);
  const signup = LANDING_NAV.signup.href;
  const perLine = "mt-2 min-h-[22px] text-sm";
  /** linha de baixo do preço: lançamento, ou a equivalência mensal no anual */
  const perText = (full: number, promo: number | null) =>
    promo != null && offer ? t.launchPer(offer.duration_months) : yearly ? t.yearlyEquivalent(brl(full / 12)) : "";

  return (
    <>
      {offer && (proPromo != null || teamPromo != null) && (
        <p
          className="lp-reveal mx-auto -mt-4 mb-10 w-fit max-w-full rounded-[20px] border border-[#D9A05B] bg-[#fff4e0] px-4 py-2 text-center text-[15px] text-[#7a4a14] sm:rounded-full"
          data-testid="aviso-preco-lancamento"
        >
          {t.launchNotice(offerEndLabel(offer), offer.duration_months)}
        </p>
      )}

      <div className="mb-12 flex justify-center">
        <div className="flex rounded-full border bg-white p-1" role="tablist" aria-label={t.toggleLabel}>
          {(["MONTHLY", "YEARLY"] as const).map((c) => (
            <button
              key={c}
              type="button"
              role="tab"
              aria-selected={cycle === c}
              onClick={() => setCycle(c)}
              className={cn(
                "inline-flex h-11 items-center rounded-full px-5 transition-colors",
                cycle === c ? "bg-foreground text-white" : "text-muted-foreground hover:text-foreground"
              )}
              data-testid={`toggle-${c === "MONTHLY" ? "mensal" : "anual"}`}
            >
              {c === "MONTHLY" ? t.monthly : t.yearly}
              {c === "YEARLY" && <em className="ml-1 text-xs font-bold not-italic text-[#C47B47]">{t.yearlyBonus}</em>}
            </button>
          ))}
        </div>
      </div>

      <div className="mx-auto grid max-w-md items-stretch gap-6 md:max-w-4xl md:grid-cols-2 min-[1100px]:max-w-none min-[1100px]:grid-cols-4">
        {/* ---------- GRÁTIS ---------- */}
        <div className={cn(lpCard, "lp-reveal flex flex-col")} data-testid="card-plano-gratis">
          <h3 className="text-[21px] font-bold">{PLAN_NAMES.gratis}</h3>
          <p className="mt-2 text-muted-foreground">{PLAN_CARDS.gratis.tagline}</p>
          <Price value={t.free.price} />
          <p className={cn(perLine, "text-muted-foreground")}>{t.free.per}</p>
          <Features items={PLAN_CARDS.gratis.items(team.included_professionals)} />
          <Link href={signup} className={lpBtnOutline} data-testid="btn-plano-gratis">{t.cta}</Link>
        </div>

        {/* ---------- BÁSICO ---------- */}
        {basic && (
          <div className={cn(lpCard, "lp-reveal flex flex-col")} data-testid="card-plano-basico">
            <h3 className="text-[21px] font-bold">{PLAN_NAMES.basico}</h3>
            <p className="mt-2 text-muted-foreground">{PLAN_CARDS.basico.tagline}</p>
            <Price value={money(basic.base_price)} per={per} />
            <p className={cn(perLine, "text-muted-foreground")}>{perText(basic.base_price, null)}</p>
            <Features items={PLAN_CARDS.basico.items(team.included_professionals)} />
            <Link href={signup} className={lpBtnOutline} data-testid="btn-plano-basico">{t.cta}</Link>
          </div>
        )}

        {/* ---------- PROFISSIONAL (destaque) ---------- */}
        {/* o deslocamento para cima fica no card interno: o revelar ao rolar mexe no transform do externo */}
        <div className="lp-reveal flex">
          <div
            className={cn(
              lpCard,
              "relative flex flex-1 flex-col border-foreground bg-foreground text-[#f3ece4] shadow-[0_30px_60px_-30px_rgba(28,25,23,0.6)] min-[900px]:-translate-y-3"
            )}
            data-testid="card-plano-profissional"
          >
            <span className="absolute -top-[13px] left-6 rounded-full bg-[#F2C078] px-3 py-1 text-xs font-bold text-foreground md:left-8">
              {t.pro.badge}
            </span>
            <h3 className="text-[21px] font-bold">{PLAN_NAMES.profissional}</h3>
            <p className="mt-2 text-stone-300">{PLAN_CARDS.profissional.tagline}</p>
            <Price
              value={money(proPromo ?? pro.base_price)}
              per={per}
              dark
              was={proPromo != null ? money(pro.base_price) : undefined}
            />
            <p className={cn(perLine, "text-stone-300")} data-testid={proPromo != null ? "selo-preco-lancamento" : undefined}>
              {perText(pro.base_price, proPromo)}
            </p>
            <Features items={PLAN_CARDS.profissional.items(team.included_professionals)} dark />
            <Link href={signup} className={lpBtnGold} data-testid="btn-plano-profissional">{t.cta}</Link>
          </div>
        </div>

        {/* ---------- EQUIPE ---------- */}
        <div className={cn(lpCard, "lp-reveal flex flex-col")} data-testid="card-plano-equipe">
          <h3 className="text-[21px] font-bold">{PLAN_NAMES.equipe}</h3>
          <p className="mt-2 text-muted-foreground">{PLAN_CARDS.equipe.tagline}</p>
          <Price
            value={money(teamPromo ?? team.base_price)}
            per={per}
            was={teamPromo != null ? money(team.base_price) : undefined}
          />
          {teamPromo != null && <p className={cn(perLine, "text-muted-foreground")}>{perText(team.base_price, teamPromo)}</p>}
          <p className={cn(perLine, "text-muted-foreground")}>{t.team.extra(money(team.extra_professional_price), per)}</p>
          <Features items={PLAN_CARDS.equipe.items(team.included_professionals)} />
          <Link href={signup} className={lpBtnOutline} data-testid="btn-plano-equipe">{t.cta}</Link>
        </div>
      </div>

      <p className="mt-10 text-center text-sm text-muted-foreground" data-testid="texto-teste-planos">{t.trialNote}</p>
      <p className="lp-reveal mx-auto mt-8 max-w-[640px] rounded-[20px] border border-dashed border-[#D9A05B] bg-white p-6 text-center">
        <b>{t.referral[0]}</b>
        {t.referral[1]}
      </p>
      <p className="mt-8 text-center text-base text-muted-foreground">
        {t.roi[0]}
        <b className="text-primary">{t.roi[1]}</b>
        {t.roi[2]}
      </p>
    </>
  );
}
