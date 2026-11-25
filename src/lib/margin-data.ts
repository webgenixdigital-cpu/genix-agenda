// Margem dos atendimentos e lucro estimado (69): finance_margin_summary no banco.
// Só a matriz e a demonstração leem (o banco confere); a partir do Básico.
// Erro (ou a 69 fora do banco): "erro", com o código no log do servidor; o Caixa mostra
// um aviso no lugar do cartão (nunca some calado).
import type { createClient } from "@/lib/supabase/server";

type Db = ReturnType<typeof createClient>;

export type MarginEstimate = {
  taxes: number;
  fees: number;
  commissions: number;
  fixed: number;
  days: number;
  profit: number;
};

export type MarginSummary = {
  revenue: number;
  cost: number;
  margin: number;
  marginPct: number | null;
  withCost: number;
  withoutCost: number;
  revenueWithoutCost: number;
  packageSessions: number;
  toReceive: number;
  /** null = calculadora não salva (ou plano abaixo do Profissional) */
  estimate: MarginEstimate | null;
};

const n = (v: unknown) => Number(v ?? 0);

export async function loadMarginSummary(db: Db, businessId: string, from: string, to: string): Promise<MarginSummary | "erro"> {
  const { data, error } = await db.rpc("finance_margin_summary", { p_business: businessId, p_from: from, p_to: to });
  if (error || !data) {
    console.error("[margem] finance_margin_summary falhou", {
      business: businessId,
      code: error?.code ?? "SEM_DADOS",
      message: error?.message,
    });
    return "erro";
  }
  const d = data as Record<string, unknown>;
  const e = d.estimate as Record<string, unknown> | null;
  return {
    revenue: n(d.revenue),
    cost: n(d.cost),
    margin: n(d.margin),
    marginPct: d.margin_pct == null ? null : n(d.margin_pct),
    withCost: n(d.with_cost),
    withoutCost: n(d.without_cost),
    revenueWithoutCost: n(d.revenue_without_cost),
    packageSessions: n(d.package_sessions),
    toReceive: n(d.to_receive),
    estimate: e
      ? { taxes: n(e.taxes), fees: n(e.fees), commissions: n(e.commissions), fixed: n(e.fixed), days: n(e.days), profit: n(e.profit) }
      : null,
  };
}
