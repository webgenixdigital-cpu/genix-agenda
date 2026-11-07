"use client";

import { useState } from "react";
import Link from "next/link";
import { LANDING_NAV, LANDING_PLANS } from "@/content/landing";
import { brl } from "@/lib/format";
import type { Plan } from "@/lib/plans-public";
import { cn } from "@/lib/utils";
import { lpBtnGold, lpBtnOutline, lpCard } from "./styles";

// Valores sempre da tabela plans (migrations 28a/28b), lidos no servidor por getPublicPlans().

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

function Price({ value, per, dark }: { value: string; per?: string; dark?: boolean }) {
  return (
    <p className="mt-4 font-heading text-[42px] leading-none">
      {value}
      {per && <small className={cn("font-sans text-[15px]", dark ? "text-stone-300" : "text-muted-foreground")}>{per}</small>}
    </p>
  );
}

/** Planos: Mensal/Anual; Grátis, Profissional (destaque escuro) e Equipe */
export function LandingPricing({ plans }: { plans: Plan[] }) {
  const t = LANDING_PLANS;
  const [cycle, setCycle] = useState<"MONTHLY" | "YEARLY">("MONTHLY");
  const yearly = cycle === "YEARLY";

  const find = (kind: Plan["kind"]) => plans.find((p) => p.kind === kind && p.billing_cycle === cycle);
  const free = plans.find((p) => p.kind === "gratis");
  const pro = find("profissional");
  const team = find("equipe");
  if (!pro || !team) return null;

  const per = yearly ? t.perYear : t.perMonth;
  const signup = LANDING_NAV.signup.href;
  const perLine = "mt-2 min-h-[22px] text-sm";

  return (
    <>
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

      <div className="mx-auto grid max-w-md items-stretch gap-6 lg:max-w-none lg:grid-cols-3">
        {/* ---------- GRÁTIS ---------- */}
        <div className={cn(lpCard, "lp-reveal flex flex-col")} data-testid="card-plano-gratis">
          <h3 className="text-[21px] font-bold">{t.free.name}</h3>
          <p className="mt-2 text-muted-foreground">{t.free.text}</p>
          <Price value={t.free.price} />
          <p className={cn(perLine, "text-muted-foreground")}>{t.free.per}</p>
          <Features items={t.free.items(free?.online_daily_limit ?? 6)} />
          <Link href={signup} className={lpBtnOutline} data-testid="btn-plano-gratis">{t.free.cta}</Link>
        </div>

        {/* ---------- PROFISSIONAL (destaque) ---------- */}
        {/* o deslocamento para cima fica no card interno: o revelar ao rolar mexe no transform do externo */}
        <div className="lp-reveal flex">
        <div
          className={cn(lpCard, "relative flex flex-1 flex-col border-foreground bg-foreground text-[#f3ece4] shadow-[0_30px_60px_-30px_rgba(28,25,23,0.6)] lg:-translate-y-3")}
          data-testid="card-plano-profissional"
        >
          <span className="absolute -top-[13px] left-6 rounded-full bg-[#F2C078] px-3 py-1 text-xs font-bold text-foreground md:left-8">
            {t.pro.badge}
          </span>
          <h3 className="text-[21px] font-bold">{t.pro.name}</h3>
          <p className="mt-2 text-stone-300">{t.pro.text}</p>
          <Price value={brl(pro.base_price)} per={per} dark />
          <p className={cn(perLine, "text-stone-300")}>{yearly ? t.pro.yearlyEquivalent(brl(pro.base_price / 12)) : ""}</p>
          <Features items={t.pro.items} dark />
          <Link href={signup} className={lpBtnGold} data-testid="btn-plano-profissional">{t.pro.cta}</Link>
        </div>
        </div>

        {/* ---------- EQUIPE ---------- */}
        <div className={cn(lpCard, "lp-reveal flex flex-col")} data-testid="card-plano-equipe">
          <h3 className="text-[21px] font-bold">{t.team.name}</h3>
          <p className="mt-2 text-muted-foreground">{t.team.text(team.included_professionals)}</p>
          <Price value={brl(team.base_price)} per={per} />
          <p className={cn(perLine, "text-muted-foreground")}>{t.team.extra(brl(team.extra_professional_price), per)}</p>
          <Features items={t.team.items} />
          <Link href={signup} className={lpBtnOutline} data-testid="btn-plano-equipe">{t.team.cta}</Link>
        </div>
      </div>

      <p className="mt-12 text-center text-base text-muted-foreground">
        {t.roi[0]}
        <b className="text-primary">{t.roi[1]}</b>
        {t.roi[2]}
      </p>
    </>
  );
}
