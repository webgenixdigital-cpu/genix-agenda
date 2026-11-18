// Tabela comparativa dos 4 planos (Assinatura). Textos em src/content/planos.ts;
// preços da tabela plans. Rola só dentro da tabela no celular (.scroll-shadow-x).
import { Check, Minus } from "lucide-react";
import { FREE_MONTHS, LAUNCH_TEXT, PLAN_ORDER, planFeatureRows, type PlanCell } from "@/content/planos";
import { PLAN_NAMES, type PlanKind } from "@/lib/plan-features";
import { brl } from "@/lib/format";
import { offerEndLabel, offerOpen, type LaunchOffer, type Plan } from "@/lib/plans-public";
import { cn } from "@/lib/utils";

function Cell({ v }: { v: PlanCell }) {
  if (v === true) return <Check className="mx-auto h-5 w-5 text-primary" aria-label="Inclui" />;
  if (v === false) return <Minus className="mx-auto h-5 w-5 text-stone-300" aria-label="Não inclui" />;
  return <span className="text-sm font-semibold">{v}</span>;
}

export function PlansComparison({
  plans,
  current,
  offer: rawOffer = null,
}: {
  plans: Plan[];
  current?: PlanKind | null;
  /** cupom de lançamento no prazo (53): preço riscado + preço com desconto */
  offer?: LaunchOffer | null;
}) {
  const offer = offerOpen(rawOffer) ? rawOffer : null;
  const limit = plans.find((p) => p.kind === "gratis")?.online_daily_limit ?? 6;
  const teamM = plans.find((p) => p.kind === "equipe" && p.billing_cycle === "MONTHLY");
  const teamY = plans.find((p) => p.kind === "equipe" && p.billing_cycle === "YEARLY");
  const included = teamM?.included_professionals ?? 3;
  const rows = planFeatureRows(limit, included);
  const plan = (k: PlanKind, c: Plan["billing_cycle"]) => plans.find((p) => p.kind === k && p.billing_cycle === c);
  const price = (k: PlanKind, c: Plan["billing_cycle"]) => plan(k, c)?.base_price;
  const promo = (k: PlanKind, c: Plan["billing_cycle"]) => {
    const id = plan(k, c)?.id;
    return offer && id && offer.prices[id] != null ? offer.prices[id] : null;
  };
  /** "R$ 48,70/mês" com o preço cheio riscado antes, se houver cupom */
  const priceText = (k: PlanKind, c: Plan["billing_cycle"], per: string) => {
    const full = price(k, c);
    if (full == null) return null;
    const p = promo(k, c);
    return p == null ? (
      <>{brl(full)}{per}</>
    ) : (
      <>
        <s className="font-normal text-muted-foreground">
          <span className="sr-only">{LAUNCH_TEXT.wasLabel(brl(full))}</span>
          <span aria-hidden>{brl(full)}</span>
        </s>{" "}
        {brl(p)}{per}
      </>
    );
  };

  return (
    <div className="scroll-shadow-x rounded-2xl border bg-card" data-testid="tabela-planos">
      <table className="w-full min-w-[640px] border-collapse text-left">
        <caption className="sr-only">O que cada plano inclui e não inclui</caption>
        <thead>
          <tr className="border-b">
            <th scope="col" className="p-3 text-sm font-semibold text-muted-foreground">Recurso</th>
            {PLAN_ORDER.map((k) => (
              <th
                key={k}
                scope="col"
                className={cn("p-3 text-center align-top", current === k && "bg-primary/5")}
                data-testid={`coluna-plano-${k}`}
              >
                <span className="block font-heading text-lg">{PLAN_NAMES[k]}</span>
                {current === k && (
                  <span className="mt-1 inline-block rounded-full bg-primary px-2 py-0.5 text-[11px] font-semibold text-primary-foreground">
                    Seu plano
                  </span>
                )}
                <span className="mt-1 block text-sm font-semibold" data-testid={`preco-tabela-${k}`}>
                  {k === "gratis" ? "R$ 0" : priceText(k, "MONTHLY", "/mês") ?? "—"}
                </span>
                <span className="block text-xs font-normal text-muted-foreground">
                  {k === "gratis" ? `por ${FREE_MONTHS} meses` : price(k, "YEARLY") != null ? <>ou {priceText(k, "YEARLY", "/ano")}</> : ""}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} className="border-b last:border-0">
              <th scope="row" className="p-3 text-sm font-normal">{r.label}</th>
              {PLAN_ORDER.map((k) => (
                <td key={k} className={cn("p-3 text-center", current === k && "bg-primary/5")}>
                  <Cell v={r.values[k]} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {teamM && (
        <p className="border-t p-3 text-xs text-muted-foreground">
          Equipe: até {included} profissionais inclusos. Cada profissional ativo a mais soma {brl(teamM.extra_professional_price)}/mês
          {teamY ? ` (ou ${brl(teamY.extra_professional_price)}/ano no anual)` : ""}. Anual = 2 meses grátis.
          {offer &&
            ` Profissional e Equipe: ${LAUNCH_TEXT.until(offer.label, offerEndLabel(offer)).toLowerCase()} para quem assinar, ${LAUNCH_TEXT.forMonths(offer.duration_months)}; depois, o preço normal. O profissional extra não tem desconto.`}
        </p>
      )}
    </div>
  );
}
