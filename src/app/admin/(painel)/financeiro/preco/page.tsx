import { Ajuda } from "@/components/ajuda";
import { createClient } from "@/lib/supabase/server";
import { requireRoles } from "@/lib/admin";
import { allows, getPlanContext } from "@/lib/plan";
import { LockedFeature } from "@/components/admin/locked-feature";
import { FinanceTabs } from "@/components/admin/financeiro/finance-tabs";
import { PricingCalculator, type CalcService, type CalcSettings } from "@/components/admin/financeiro/pricing-calculator";

export const dynamic = "force-dynamic";

// Calculadora de preço de venda (69): matriz e demonstração; Profissional e Equipe.
export default async function PrecoPage() {
  const { business } = await requireRoles(["owner", "viewer"]);
  const plan = await getPlanContext(business.id);
  if (plan.tier === "gratis") return <LockedFeature feature="financeiro" />;

  const header = (
    <header className="flex flex-col items-center gap-4 text-center">
      <div>
        <h1 className="text-3xl md:text-4xl">
          Financeiro <Ajuda id="preco-calculadora" className="-ml-2" />
        </h1>
        <div className="mt-3">
          <FinanceTabs active="preco" />
        </div>
      </div>
    </header>
  );

  if (!allows(plan, "profissional")) {
    return (
      <>
        <div className="mx-auto max-w-2xl px-4 pt-4 md:px-8 md:pt-8">{header}</div>
        <LockedFeature feature="calculadora" />
      </>
    );
  }

  const supabase = createClient();
  const [{ data: saved }, { data: sug }] = await Promise.all([
    supabase.from("pricing_settings").select("*").eq("business_id", business.id).maybeSingle(),
    supabase.rpc("pricing_suggestions", { p_business: business.id }),
  ]);

  const s = (sug ?? {}) as {
    expenses?: Record<string, number>;
    hours_month?: number | null;
    commission_avg?: number | null;
    services?: { id: string; name: string; kind: string | null; price: number; duration_min: number; cost: number | null }[];
  };
  const num = (v: unknown) => (v == null ? null : Number(v));
  const settings: CalcSettings | null = saved
    ? {
        regime: (saved.regime as CalcSettings["regime"]) ?? null,
        tax_pct: Number(saved.tax_pct),
        fixed_costs: ((saved.fixed_costs ?? []) as { key: string; label: string; amount: number }[]).map((c) => ({ ...c, amount: Number(c.amount) })),
        hours_month: num(saved.hours_month),
        fee_credito_pct: Number(saved.fee_credito_pct),
        fee_debito_pct: Number(saved.fee_debito_pct),
        fee_pix_pct: Number(saved.fee_pix_pct),
        fee_dinheiro_pct: Number(saved.fee_dinheiro_pct),
        commission_pct: Number(saved.commission_pct),
        target_margin_pct: Number(saved.target_margin_pct),
      }
    : null;
  const services: CalcService[] = (s.services ?? []).map((x) => ({
    id: x.id,
    name: x.name,
    combo: x.kind === "combo",
    price: Number(x.price),
    duration_min: Number(x.duration_min),
    cost: num(x.cost),
  }));

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-4 md:space-y-8 md:p-8">
      {header}
      <PricingCalculator
        settings={settings}
        suggestions={{
          expenses: s.expenses ?? {},
          hoursMonth: num(s.hours_month),
          commissionAvg: num(s.commission_avg),
        }}
        services={services}
        team={allows(plan, "equipe")}
      />
    </main>
  );
}
