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
};

function refresh(slug: string) {
  revalidatePath("/admin/servicos");
  revalidatePath(`/v/${slug}`);
  revalidatePath("/");
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

  const row = {
    name,
    description: input.description.trim() || null,
    category: input.category.trim() || null,
    price: Math.round(input.price * 100) / 100,
    duration_min: input.duration_min,
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
  if (error) return { ok: false, error: "Não foi possível atualizar." };
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