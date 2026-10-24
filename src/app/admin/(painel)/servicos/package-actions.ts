"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getEditorContext } from "@/lib/admin";
import { getPlanContext } from "@/lib/plan";

type Result = { ok: true } | { ok: false; error: string };

export type PackageTemplateInput = {
  id?: string;
  service_id: string;
  name: string;
  sessions: number;
  price: number;
  validity_days: number | null;
};

const ONLY_OWNER = "Somente a matriz pode gerenciar os pacotes.";
const FULL_ONLY = "Pacotes são um recurso do plano Completo.";

// ---------------------------------------------------------------------
// PARTE 1 — Criar / editar modelo de pacote
// ---------------------------------------------------------------------
export async function savePackageTemplate(input: PackageTemplateInput): Promise<Result> {
  const { business, role } = await getEditorContext();
  if (role !== "owner") return { ok: false, error: ONLY_OWNER };
  if ((await getPlanContext(business.id)).tier !== "completo") return { ok: false, error: FULL_ONLY };

  const name = input.name.trim();
  if (name.length < 2) return { ok: false, error: "Dê um nome ao pacote." };
  if (!(Number.isInteger(input.sessions) && input.sessions >= 1 && input.sessions <= 100))
    return { ok: false, error: "O pacote deve ter de 1 a 100 sessões." };
  if (!(input.price >= 0)) return { ok: false, error: "Preço inválido." };
  const days = input.validity_days;
  if (days !== null && !(Number.isInteger(days) && days >= 1 && days <= 730))
    return { ok: false, error: "A validade deve ser entre 1 e 730 dias." };

  const supabase = createClient();
  const { data: service } = await supabase
    .from("services").select("id").eq("id", input.service_id).eq("business_id", business.id).maybeSingle();
  if (!service) return { ok: false, error: "Escolha o serviço do pacote." };

  const row = {
    service_id: service.id,
    name: name.slice(0, 80),
    sessions: input.sessions,
    price: Math.round(input.price * 100) / 100,
    validity_days: days,
  };

  if (input.id) {
    const { error } = await supabase.from("package_templates").update(row).eq("id", input.id).eq("business_id", business.id);
    if (error) return { ok: false, error: "Não foi possível salvar o pacote." };
  } else {
    const { data: last } = await supabase
      .from("package_templates").select("sort_order").eq("business_id", business.id)
      .order("sort_order", { ascending: false }).limit(1).maybeSingle();
    const { error } = await supabase
      .from("package_templates")
      .insert({ ...row, business_id: business.id, sort_order: (last?.sort_order ?? 0) + 1 });
    if (error) return { ok: false, error: "Não foi possível criar o pacote." };
  }

  revalidatePath("/admin/servicos");
  return { ok: true };
}

// ---------------------------------------------------------------------
// PARTE 2 — Ativar / desativar (pacotes já vendidos não mudam)
// ---------------------------------------------------------------------
export async function togglePackageTemplate(id: string, active: boolean): Promise<Result> {
  const { business, role } = await getEditorContext();
  if (role !== "owner") return { ok: false, error: ONLY_OWNER };
  if ((await getPlanContext(business.id)).tier !== "completo") return { ok: false, error: FULL_ONLY };

  const supabase = createClient();
  const { error } = await supabase.from("package_templates").update({ active }).eq("id", id).eq("business_id", business.id);
  if (error) return { ok: false, error: "Não foi possível atualizar." };
  revalidatePath("/admin/servicos");
  return { ok: true };
}

// ---------------------------------------------------------------------
// PARTE 3 — Excluir modelo (pacotes vendidos ficam, com o snapshot)
// ---------------------------------------------------------------------
export async function deletePackageTemplate(id: string): Promise<Result> {
  const { business, role } = await getEditorContext();
  if (role !== "owner") return { ok: false, error: ONLY_OWNER };
  if ((await getPlanContext(business.id)).tier !== "completo") return { ok: false, error: FULL_ONLY };

  const supabase = createClient();
  const { error } = await supabase.from("package_templates").delete().eq("id", id).eq("business_id", business.id);
  if (error) return { ok: false, error: "Não foi possível excluir." };
  revalidatePath("/admin/servicos");
  return { ok: true };
}
