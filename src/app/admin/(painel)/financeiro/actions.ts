"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getEditorContext } from "@/lib/admin";

type Result = { ok: true } | { ok: false; error: string };

export type CashInput = {
  kind: "income" | "expense";
  category: "atendimento" | "comissao" | "produtos" | "aluguel" | "outros";
  method: "pix" | "dinheiro" | "credito" | "debito";
  amount: number;
  description: string;
  date: string; // YYYY-MM-DD
};

function refresh() {
  revalidatePath("/admin/financeiro");
  revalidatePath("/admin");
}

export async function addCashEntry(input: CashInput): Promise<Result> {
  const { business, userId } = await getEditorContext();
  const supabase = createClient();

  if (!(input.amount > 0)) return { ok: false, error: "Informe o valor." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) return { ok: false, error: "Escolha a data." };

  const { error } = await supabase.from("cash_entries").insert({
    business_id: business.id,
    kind: input.kind,
    category: input.category,
    method: input.method,
    amount: Math.round(input.amount * 100) / 100,
    description: input.description.trim() || null,
    entry_date: input.date,
    created_by: userId,
  });
  if (error) {
    // 68: lançamento ligado a atendimento/pacote não pode passar do cobrado
    if (error.message.includes("VALOR_ACIMA_DO_SALDO")) {
      return { ok: false, error: "Esse valor passa do que falta pagar neste atendimento." };
    }
    return { ok: false, error: "Não foi possível salvar o lançamento." };
  }
  refresh();
  return { ok: true };
}

export async function deleteCashEntry(id: string): Promise<Result> {
  const { business } = await getEditorContext();
  const supabase = createClient();
  const { error } = await supabase.from("cash_entries").delete().eq("id", id).eq("business_id", business.id);
  if (error) return { ok: false, error: "Não foi possível excluir." };
  refresh();
  return { ok: true };
}
// ---------------------------------------------------------------------
// 69 — Calculadora de preço: configurações do espaço (save_pricing_settings,
// só a matriz, a partir do Profissional)
// ---------------------------------------------------------------------
export type PricingSettingsInput = {
  regime: "mei" | "simples" | "autonomo" | "nao_sei" | null;
  tax_pct: number;
  fixed_costs: { key: string; label: string; amount: number }[];
  hours_month: number | null;
  fee_credito_pct: number;
  fee_debito_pct: number;
  fee_pix_pct: number;
  fee_dinheiro_pct: number;
  commission_pct: number;
  target_margin_pct: number;
};

const PRICING_ERRORS: Record<string, string> = {
  PLANO_PROFISSIONAL: "A Calculadora de preço é um recurso dos planos Profissional e Equipe.",
  SEM_PERMISSAO: "Só a matriz pode salvar as configurações da calculadora.",
  DADOS_INVALIDOS: "Confira os valores: porcentagens de 0 a 100 e custos sem valor negativo.",
};

export async function savePricingSettings(input: PricingSettingsInput): Promise<Result> {
  const { business, role } = await getEditorContext();
  if (role !== "owner") return { ok: false, error: PRICING_ERRORS.SEM_PERMISSAO };
  const supabase = createClient();
  const { error } = await supabase.rpc("save_pricing_settings", {
    p_business: business.id,
    p: {
      ...input,
      fixed_costs: input.fixed_costs.filter((c) => c.amount > 0).slice(0, 20),
    },
  });
  if (error) {
    const key = Object.keys(PRICING_ERRORS).find((k) => error.message.includes(k));
    return { ok: false, error: key ? PRICING_ERRORS[key] : "Não foi possível salvar as configurações." };
  }
  revalidatePath("/admin/financeiro/preco");
  revalidatePath("/admin/financeiro");
  return { ok: true };
}
