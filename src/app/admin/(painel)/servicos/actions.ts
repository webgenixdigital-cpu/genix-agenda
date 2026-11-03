"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getEditorContext } from "@/lib/admin";

type Result = { ok: true } | { ok: false; error: string };

export type ServiceInput = {
  id?: string;
  name: string;
  description: string;
  category: string;
  price: number;
  duration_min: number;
  return_after_days: number | null;
};

function refresh(slug: string) {
  revalidatePath("/admin/servicos");
  revalidatePath(`/v/${slug}`);
  revalidatePath("/espacos");
}

// ---------------------------------------------------------------------
// PARTE 1 — Criar / editar
// ---------------------------------------------------------------------
export async function saveService(input: ServiceInput): Promise<Result> {
  const { business } = await getEditorContext();
  const supabase = createClient();

  const name = input.name.trim();
  if (name.length < 2) return { ok: false, error: "Dê um nome ao serviço." };
  if (!(input.price >= 0)) return { ok: false, error: "Preço inválido." };
  if (!(input.duration_min >= 5 && input.duration_min <= 600)) return { ok: false, error: "Escolha a duração." };
  const ret = input.return_after_days;
  if (ret !== null && !(Number.isInteger(ret) && ret >= 1 && ret <= 365))
    return { ok: false, error: "O retorno deve ser entre 1 e 365 dias." };

  const row = {
    name,
    description: input.description.trim() || null,
    category: input.category.trim() || null,
    price: Math.round(input.price * 100) / 100,
    duration_min: input.duration_min,
    return_after_days: ret,
  };

  if (input.id) {
    const { error } = await supabase.from("services").update(row).eq("id", input.id).eq("business_id", business.id);
    if (error) return { ok: false, error: "Não foi possível salvar." };
  } else {
    // novo serviço entra no fim da lista
    const { data: last } = await supabase
      .from("services").select("sort_order").eq("business_id", business.id)
      .order("sort_order", { ascending: false }).limit(1).maybeSingle();
    const { error } = await supabase
      .from("services")
      .insert({ ...row, business_id: business.id, sort_order: (last?.sort_order ?? 0) + 1 });
    if (error) return { ok: false, error: "Não foi possível criar o serviço." };
  }

  refresh(business.slug);
  return { ok: true };
}

// ---------------------------------------------------------------------
// PARTE 2 — Chaves (ativo / agendamento online / catálogo)
// ---------------------------------------------------------------------
export async function toggleService(
  id: string,
  field: "active" | "bookable_online" | "show_in_catalog",
  value: boolean
): Promise<Result> {
  const { business } = await getEditorContext();
  const supabase = createClient();
  const { error } = await supabase.from("services").update({ [field]: value }).eq("id", id).eq("business_id", business.id);
  if (error) {
    return {
      ok: false,
      error: error.message.includes("COMBO_INCOMPLETO")
        ? "Esse combo precisa de pelo menos 2 serviços ativos. Edite o combo ou reative os serviços."
        : "Não foi possível atualizar.",
    };
  }
  refresh(business.slug);
  return { ok: true };
}

// ---------------------------------------------------------------------
// PARTE 3 — Excluir
// ---------------------------------------------------------------------
export async function deleteService(id: string): Promise<Result> {
  const { business } = await getEditorContext();
  const supabase = createClient();
  const { error } = await supabase.from("services").delete().eq("id", id).eq("business_id", business.id);
  if (error) return { ok: false, error: "Não foi possível excluir." };
  refresh(business.slug);
  return { ok: true };
}
// ---------------------------------------------------------------------
// PARTE 4 — Combos (regras no banco: save_combo, 32_combos.sql)
// Ativo / online / catálogo e excluir usam toggleService e deleteService.
// ---------------------------------------------------------------------
export type ComboInput = {
  id?: string;
  name: string;
  description: string;
  category: string;
  price: number;
  serviceIds: string[];
};

const COMBO_ERRORS: Record<string, string> = {
  PLANO_GRATIS: "Combos são um recurso dos planos Profissional e Equipe.",
  SEM_PERMISSAO: "Só o dono do espaço pode criar ou editar combos.",
  NOME_INVALIDO: "Dê um nome ao combo (2 a 80 letras).",
  QUANTIDADE_INVALIDA: "Escolha de 2 a 6 serviços diferentes.",
  SERVICOS_INVALIDOS: "Escolha só serviços ativos do espaço.",
  PRECO_INVALIDO: "Informe o preço especial.",
  PRECO_ACIMA: "O preço do combo não pode ser maior que o valor normal dos serviços.",
  DURACAO_MAXIMA: "A soma das durações passa de 10 horas.",
  NAO_ENCONTRADO: "Combo não encontrado.",
};

export async function saveCombo(input: ComboInput): Promise<Result> {
  const { business, role } = await getEditorContext();
  if (role !== "owner") return { ok: false, error: COMBO_ERRORS.SEM_PERMISSAO };
  if (!(input.price >= 0)) return { ok: false, error: COMBO_ERRORS.PRECO_INVALIDO };

  const supabase = createClient();
  const { error } = await supabase.rpc("save_combo", {
    p_business: business.id,
    p_id: input.id ?? null,
    p_name: input.name.trim(),
    p_description: input.description.trim() || null,
    p_category: input.category.trim() || null,
    p_price: Math.round(input.price * 100) / 100,
    p_service_ids: input.serviceIds,
  });
  if (error) {
    const key = Object.keys(COMBO_ERRORS).find((k) => error.message.includes(k));
    return { ok: false, error: key ? COMBO_ERRORS[key] : "Não foi possível salvar o combo." };
  }
  refresh(business.slug);
  return { ok: true };
}
