"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getEditorContext } from "@/lib/admin";
import { getPlanContext } from "@/lib/plan";

type Result = { ok: true } | { ok: false; error: string };

export type PackageTemplateItem = { service_id: string; sessions: number };

export type PackageTemplateInput = {
  id?: string;
  name: string;
  price: number;
  validity_days: number | null;
  /** 37_plano_fechado: 1 a 6 serviços, cada um com a quantidade de sessões */
  items: PackageTemplateItem[];
};

const ONLY_OWNER = "Somente a matriz pode gerenciar os pacotes.";
const FULL_ONLY = "Pacotes são um recurso dos planos Profissional e Equipe.";

// erros de save_package_template (37_plano_fechado.sql)
const TEMPLATE_ERRORS: Record<string, string> = {
  SEM_PERMISSAO: ONLY_OWNER,
  PLANO_GRATIS: FULL_ONLY,
  NOME_INVALIDO: "Dê um nome ao pacote (2 a 80 letras).",
  QUANTIDADE_INVALIDA: "Escolha de 1 a 6 serviços diferentes.",
  SESSOES_INVALIDAS: "Cada serviço precisa de pelo menos 1 sessão, e o pacote pode ter até 100 sessões no total.",
  SERVICOS_INVALIDOS: "Escolha só serviços ativos (combos não entram em pacote).",
  PRECO_INVALIDO: "Preço inválido.",
  VALIDADE_INVALIDA: "A validade deve ser entre 1 e 730 dias.",
  NAO_ENCONTRADO: "Esse pacote não existe mais.",
};

// ---------------------------------------------------------------------
// PARTE 1 — Criar / editar modelo de pacote (regras no banco: save_package_template)
// ---------------------------------------------------------------------
export async function savePackageTemplate(input: PackageTemplateInput): Promise<Result> {
  const { business, role } = await getEditorContext();
  if (role !== "owner") return { ok: false, error: ONLY_OWNER };
  if ((await getPlanContext(business.id)).tier !== "completo") return { ok: false, error: FULL_ONLY };

  const name = input.name.trim();
  if (name.length < 2) return { ok: false, error: TEMPLATE_ERRORS.NOME_INVALIDO };
  const items = input.items.filter((i) => i.service_id);
  if (items.length < 1 || items.length > 6 || new Set(items.map((i) => i.service_id)).size !== items.length)
    return { ok: false, error: TEMPLATE_ERRORS.QUANTIDADE_INVALIDA };
  const total = items.reduce((s, i) => s + i.sessions, 0);
  if (items.some((i) => !Number.isInteger(i.sessions) || i.sessions < 1) || total > 100)
    return { ok: false, error: TEMPLATE_ERRORS.SESSOES_INVALIDAS };
  if (!(input.price >= 0)) return { ok: false, error: TEMPLATE_ERRORS.PRECO_INVALIDO };
  const days = input.validity_days;
  if (days !== null && !(Number.isInteger(days) && days >= 1 && days <= 730))
    return { ok: false, error: TEMPLATE_ERRORS.VALIDADE_INVALIDA };

  const supabase = createClient();
  const { error } = await supabase.rpc("save_package_template", {
    p_business: business.id,
    p_id: input.id ?? null,
    p_name: name.slice(0, 80),
    p_price: Math.round(input.price * 100) / 100,
    p_validity_days: days,
    p_items: items.map((i) => ({ service_id: i.service_id, sessions: i.sessions })),
  });
  if (error) {
    const key = Object.keys(TEMPLATE_ERRORS).find((k) => error.message.includes(k));
    return { ok: false, error: (key && TEMPLATE_ERRORS[key]) || "Não foi possível salvar o pacote." };
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
