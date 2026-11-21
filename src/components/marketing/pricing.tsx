"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FREE_MONTHS, LAUNCH_TEXT, PLAN_CARDS, PLAN_PROMISE, TRIAL_DAYS } from "@/content/planos";
import { useOfferOpen } from "@/components/use-offer-open";
import { brl } from "@/lib/format";
import { offerEndLabel, offerPrice, type LaunchOffer, type Plan } from "@/lib/plans-public";
import { cn } from "@/lib/utils";

// Valores vêm da tabela plans (migrations 28a/52); textos em src/content/planos.ts.
// Preço de lançamento (53): launch_offer() no servidor, escondido no navegador quando o prazo acaba.

function Item({ children, strong }: { children: React.ReactNode; strong?: boolean }) {
  return (
    <li className={cn("flex gap-2.5 text-left", strong && "font-semibold")}>
      <Check className="mt-0.5 h-5 w-5 shrink-0 text-primary" /> {children}
    </li>
  );
}

function PriceLine({ value, per, testid, was }: { value: string; per: string; testid?: string; was?: string }) {
  return (
    <>
      {was && (
        <p className="mt-3 text-sm text-muted-foreground line-through">
          <span className="sr-only">{LAUNCH_TEXT.wasLabel(was)}</span>
          <span aria-hidden>{was}{per}</span>
        </p>
      )}
      <div className={cn("flex flex-wrap items-end justify-center gap-x-2 gap-y-1", was ? "mt-1" : "mt-3")}>
        <p className="font-heading text-4xl leading-none md:text-5xl" data-testid={testid}>{value}</p>
        <p className="pb-1 text-muted-foreground">{per}</p>
      </div>
    </>
  );
}

/** selo "Preço de lançamento até 31/12/2026 · por 12 meses" */
function LaunchBadge({ offer }: { offer: LaunchOffer }) {
  return (
    <p className="mx-auto mt-3 w-fit rounded-full bg-[#F2C078]/40 px-3 py-1 text-xs font-bold text-[#7a4520]" data-testid="selo-preco-lancamento">
      {LAUNCH_TEXT.until(offer.label, offerEndLabel(offer))} · {LAUNCH_TEXT.forMonths(offer.duration_months)}
    </p>
  );
}

// ---------------------------------------------------------------------
// Componente: Grátis, Básico, Profissional (destaque) e Equipe (com calculadora)
// ---------------------------------------------------------------------
export function Pricing({ plans, offer: serverOffer = null }: { plans: Plan[]; offer?: LaunchOffer | null }) {
  const [cycle, setCycle] = useState<"MONTHLY" | "YEARLY">("YEARLY");
  const offer = useOfferOpen(serverOffer);
  const [pros, setPros] = useState(3);

  const find = (kind: Plan["kind"], c: Plan["billing_cycle"]) => plans.find((p) => p.kind === kind && p.billing_cycle === c);
  const basic = find("basico", cycle);
  const pro = find("profissional", cycle);
  const team = find("equipe", cycle);
  const teamMonthly = find("equipe", "MONTHLY");
  if (!pro || !team) return null;

  const yearly = cycle === "YEARLY";
  const per = yearly ? "/ano" : "/mês";
  const included = team.included_professionals;
  const extras = Math.max(pros - included, 0);
  const teamTotal = team.base_price + extras * team.extra_professional_price;
  const equiv = (v: number) => (yearly ? `Equivale a ${brl(v / 12)}/mês.` : "Sem fidelidade. Cancele quando quiser.");
  // cupom de lançamento: extra do Equipe sem desconto
  const proPromo = offerPrice(offer, pro);
  const teamPromo = offerPrice(offer, team);
  const teamPromoTotal = teamPromo != null ? teamPromo + extras * team.extra_professional_price : null;
  const promoNote = (full: number, promo: number) =>
    `${yearly ? `Equivale a ${brl(promo / 12)}/mês; ` : ""}${LAUNCH_TEXT.then(brl(full), per)}.`;

  return (
    <div className="mx-auto max-w-5xl text-center">
      {/* Alternância mensal / anual */}
      <div className="flex flex-col items-center gap-2">
        <div className="inline-flex rounded-full border bg-white p-1" role="tablist" aria-label="Forma de pagamento">
          {(["MONTHLY", "YEARLY"] as const).map((c) => (
            <button
              key={c}
              role="tab"
              aria-selected={cycle === c}
              onClick={() => setCycle(c)}
              className={cn(
                "inline-flex h-11 items-center gap-2 rounded-full px-6 text-sm font-semibold transition-colors",
                cycle === c ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              )}
              data-testid={`toggle-${c === "MONTHLY" ? "mensal" : "anual"}`}
            >
              {c === "MONTHLY" ? "Mensal" : "Anual"}
            </button>
          ))}
        </div>
        <p className="text-sm font-semibold text-green-700">2 meses grátis no plano anual</p>
      </div>

      <div className="mt-10 grid items-start gap-8 md:grid-cols-2">
        {/* ---------- GRÁTIS ---------- */}
        <div className="rounded-3xl border bg-card p-6 md:p-8" data-testid="card-plano-gratis">
          <p className="text-sm font-semibold text-muted-foreground">Grátis</p>
          <PriceLine value="R$ 0" per={`por ${FREE_MONTHS} meses`} />
          <p className="mt-2 text-sm text-muted-foreground">{PLAN_CARDS.gratis.tagline}</p>
          <ul className="mx-auto mt-8 w-fit space-y-3">
            {PLAN_CARDS.gratis.items(included).map((f) => (
              <Item key={f}>{f}</Item>
            ))}
          </ul>
          <Button asChild variant="outline" className="mt-8 h-12 w-full text-base" data-testid="btn-plano-gratis">
            <Link href="/cadastro">Criar conta grátis</Link>
          </Button>
          <p className="mt-3 text-xs text-muted-foreground">
            Com o selo “Feito com Genix Agenda” no cartão de visita. {PLAN_PROMISE.freeOver}
          </p>
        </div>

        {/* ---------- BÁSICO ---------- */}
        {basic && (
          <div className="rounded-3xl border bg-card p-6 md:p-8" data-testid="card-plano-basico">
            <p className="text-sm font-semibold text-muted-foreground">Básico</p>
            <PriceLine value={brl(basic.base_price)} per={per} testid="preco-basico" />
            <p className="mt-2 text-sm text-muted-foreground">{equiv(basic.base_price)}</p>
            <ul className="mx-auto mt-8 w-fit space-y-3">
              <Item strong>{PLAN_CARDS.basico.items(included)[0]}, mais:</Item>
              {PLAN_CARDS.basico.items(included).slice(1).map((f) => (
                <Item key={f}>{f}</Item>
              ))}
            </ul>
            <p className="mt-6 text-sm text-muted-foreground">{PLAN_CARDS.basico.tagline}</p>
            <Button asChild variant="outline" className="mt-8 h-12 w-full text-base" data-testid="btn-plano-basico">
              <Link href="/cadastro">Testar {TRIAL_DAYS} dias grátis</Link>
            </Button>
          </div>
        )}

        {/* ---------- PROFISSIONAL ---------- */}
        <div className="relative rounded-3xl border-2 border-primary bg-card p-6 shadow-sm md:p-8" data-testid="card-plano-profissional">
          <span className="absolute -top-3 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground">
            Para quem atende sozinho
          </span>
          <p className="text-sm font-semibold text-primary">Profissional</p>
          {offer && proPromo != null && <LaunchBadge offer={offer} />}
          <PriceLine
            value={brl(proPromo ?? pro.base_price)}
            per={per}
            testid="preco-profissional"
            was={proPromo != null ? brl(pro.base_price) : undefined}
          />
          <p className="mt-2 text-sm text-muted-foreground">
            {proPromo != null ? promoNote(pro.base_price, proPromo) : equiv(pro.base_price)}
          </p>
          <p className="mt-2 text-sm font-semibold">{PLAN_CARDS.profissional.tagline}</p>
          <ul className="mx-auto mt-8 w-fit space-y-3">
            {PLAN_CARDS.profissional.items(included).map((f, i) => (
              <Item key={f} strong={i === 0}>{f}</Item>
            ))}
          </ul>
          <p className="mt-6 text-sm text-muted-foreground">Para 1 profissional. Se a equipe crescer, é só mudar para o Equipe.</p>
          <Button asChild className="mt-8 h-12 w-full text-base active:scale-95" data-testid="btn-plano-profissional">
            <Link href="/cadastro">Testar {TRIAL_DAYS} dias grátis</Link>
          </Button>
        </div>

        {/* ---------- EQUIPE ---------- */}
        <div className="relative rounded-3xl border-2 border-[#C47B47] bg-card p-6 shadow-sm md:p-8" data-testid="card-plano-equipe">
          <span className="absolute -top-3 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-[#C47B47] px-3 py-1 text-xs font-semibold text-white">
            Para salões e equipes
          </span>
          <p className="text-sm font-semibold text-[#99582A]">Equipe</p>
          {offer && teamPromoTotal != null && <LaunchBadge offer={offer} />}
          <PriceLine
            value={brl(teamPromoTotal ?? teamTotal)}
            per={per}
            testid="preco-total"
            was={teamPromoTotal != null ? brl(teamTotal) : undefined}
          />
          <p className="mt-2 text-sm text-muted-foreground">
            {teamPromoTotal != null ? promoNote(teamTotal, teamPromoTotal) : equiv(teamTotal)}
          </p>
          <ul className="mx-auto mt-8 w-fit space-y-3">
            {PLAN_CARDS.equipe.items(included).map((f, i) => (
              <Item key={f} strong={i === 0}>{f}</Item>
            ))}
          </ul>

          {/* Calculadora (só no Equipe) */}
          <div className="mt-8 rounded-2xl bg-secondary p-4">
            <p className="text-sm font-semibold">Quantas pessoas atendem no seu espaço?</p>
            <div className="mt-3 flex flex-col items-center gap-3">
              <div className="flex items-center rounded-xl bg-white p-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-11 w-11"
                  onClick={() => setPros((n) => Math.max(1, n - 1))}
                  disabled={pros <= 1}
                  aria-label="Menos profissionais"
                  data-testid="btn-menos-profissionais"
                >
                  <Minus className="h-5 w-5" />
                </Button>
                <span className="w-10 text-center font-heading text-2xl" data-testid="qtd-profissionais">{pros}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-11 w-11"
                  onClick={() => setPros((n) => Math.min(30, n + 1))}
                  aria-label="Mais profissionais"
                  data-testid="btn-mais-profissionais"
                >
                  <Plus className="h-5 w-5" />
                </Button>
              </div>
              <p className="text-sm text-muted-foreground">
                {extras === 0
                  ? `Até ${included} profissionais já estão no preço.`
                  : `${extras} ${extras === 1 ? "extra" : "extras"} × ${brl(team.extra_professional_price)} = ${brl(extras * team.extra_professional_price)}`}
              </p>
            </div>
            {teamMonthly && (
              <p className="mt-2 text-xs text-muted-foreground">
                Profissional extra: {brl(teamMonthly.extra_professional_price)}/mês por pessoa além de {included}.
              </p>
            )}
          </div>

          <Button asChild className="mt-8 h-12 w-full text-base active:scale-95" data-testid="btn-plano-teste">
            <Link href="/cadastro">Testar {TRIAL_DAYS} dias grátis</Link>
          </Button>
        </div>
      </div>

      <p className="copy mt-8 text-sm text-muted-foreground">
        Toda conta nova tem {PLAN_PROMISE.trial}, sem cartão. {PLAN_PROMISE.afterTrial}
      </p>
    </div>
  );
}
