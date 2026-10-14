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
  if (error) return { ok: false, error: "Não foi possível salvar o lançamento." };
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