"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

type Result = { ok: true } | { ok: false; error: string };

async function adminClient() {
  const supabase = createClient();
  const { data: isAdmin } = await supabase.rpc("is_platform_admin");
  return isAdmin ? supabase : null;
}

// "Fórmula de coloração" → "formula_de_coloracao"
const toKey = (v: string) =>
  v
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^(\d)/, "c_$1")
    .slice(0, 40);

export async function saveProfileField(input: {
  id?: string;
  niche_id: string;
  label: string;
  type: "text" | "textarea" | "select";
  options: string;   // uma opção por linha
  help: string;
  sort_order: number;
}): Promise<Result> {
  const supabase = await adminClient();
  if (!supabase) return { ok: false, error: "Acesso negado." };

  const label = input.label.trim();
  if (label.length < 2) return { ok: false, error: "Informe o nome do campo." };
  if (!["text", "textarea", "select"].includes(input.type)) return { ok: false, error: "Tipo inválido." };

  const options = input.options.split("\n").map((o) => o.trim()).filter(Boolean).slice(0, 20);
  if (input.type === "select" && options.length < 2) return { ok: false, error: "Lista de opções: informe pelo menos 2 (uma por linha)." };

  const row = {
    label,
    type: input.type,
    options: input.type === "select" ? options : [],
    help: input.help.trim() || null,
    sort_order: Math.round(input.sort_order) || 0,
  };

  if (input.id) {
    // a chave não muda depois de criada (é onde as respostas ficam guardadas)
    const { error } = await supabase.from("niche_profile_fields").update(row).eq("id", input.id);
    if (error) return { ok: false, error: "Não foi possível salvar o campo." };
  } else {
    const key = toKey(label);
    if (!key) return { ok: false, error: "Nome do campo inválido." };
    const { error } = await supabase.from("niche_profile_fields").insert({ ...row, niche_id: input.niche_id, key });
    if (error) {
      return { ok: false, error: error.code === "23505" ? "Já existe um campo com esse nome neste nicho." : "Não foi possível criar o campo." };
    }
  }

  revalidatePath("/genix");
  return { ok: true };
}

export async function toggleProfileField(id: string, active: boolean): Promise<Result> {
  const supabase = await adminClient();
  if (!supabase) return { ok: false, error: "Acesso negado." };
  const { error } = await supabase.from("niche_profile_fields").update({ active }).eq("id", id);
  if (error) return { ok: false, error: "Não foi possível atualizar." };
  revalidatePath("/genix");
  return { ok: true };
}
