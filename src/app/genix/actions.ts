"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

type Result = { ok: true } | { ok: false; error: string };

const SEGMENTS = ["beleza", "estetica", "outros"];
const ICONS = ["scissors", "hand", "eye", "brush", "sparkles", "flower", "pen", "dumbbell", "calendar", "heart", "star"];

// ---------------------------------------------------------------------
// PARTE 1 — Só administradores da plataforma
// ---------------------------------------------------------------------
async function adminClient() {
  const supabase = createClient();
  const { data: isAdmin } = await supabase.rpc("is_platform_admin");
  if (!isAdmin) return null;
  return supabase;
}

function refresh() {
  revalidatePath("/genix");
  revalidatePath("/", "layout"); // Home, cadastro, configurações e vitrines
}

// ---------------------------------------------------------------------
// PARTE 2 — Nichos
// ---------------------------------------------------------------------
export async function saveNiche(input: {
  originalId?: string;
  id: string;
  segment: string;
  name: string;
  description: string;
  icon: string;
  sort_order: number;
  featured: boolean;
  featured_order: number | null;
}): Promise<Result> {
  const supabase = await adminClient();
  if (!supabase) return { ok: false, error: "Acesso negado." };

  const featuredOrder = input.featured_order == null ? null : Math.round(input.featured_order);
  if (input.featured && featuredOrder != null && (featuredOrder < 1 || featuredOrder > 99)) {
    return { ok: false, error: "Ordem no destaque: use um número de 1 a 99." };
  }

  const id = input.id.trim().toLowerCase();
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id) || id.length < 3) {
    return { ok: false, error: "Identificador: só letras minúsculas, números e hífen (ex.: podologia)." };
  }
  if (input.name.trim().length < 2) return { ok: false, error: "Informe o nome." };
  if (!SEGMENTS.includes(input.segment)) return { ok: false, error: "Segmento inválido." };
  if (!ICONS.includes(input.icon)) return { ok: false, error: "Ícone inválido." };

  const row = {
    id,
    segment: input.segment,
    name: input.name.trim(),
    description: input.description.trim() || null,
    icon: input.icon,
    sort_order: Math.round(input.sort_order) || 0,
    // destaque nos círculos da página principal ("/")
    featured: !!input.featured,
    featured_order: input.featured ? featuredOrder : null,
  };

  if (input.originalId) {
    // o identificador fica fixo depois de criado (é usado pelos espaços)
    const { error } = await supabase.from("niches").update({ ...row, id: input.originalId }).eq("id", input.originalId);
    if (error) return { ok: false, error: "Não foi possível salvar o nicho." };
  } else {
    const { error } = await supabase.from("niches").insert(row);
    if (error) {
      return { ok: false, error: error.code === "23505" ? "Já existe um nicho com esse identificador." : "Não foi possível criar o nicho." };
    }
  }

  refresh();
  return { ok: true };
}

export async function toggleNiche(id: string, active: boolean): Promise<Result> {
  const supabase = await adminClient();
  if (!supabase) return { ok: false, error: "Acesso negado." };
  const { error } = await supabase.from("niches").update({ active }).eq("id", id);
  if (error) return { ok: false, error: "Não foi possível atualizar." };
  refresh();
  return { ok: true };
}

export async function deleteNiche(id: string): Promise<Result> {
  const supabase = await adminClient();
  if (!supabase) return { ok: false, error: "Acesso negado." };

  const { data: used } = await supabase.rpc("niche_usage_count", { p_niche: id });
  if (Number(used) > 0) {
    return { ok: false, error: `${used} espaço(s) usam este nicho. Desative em vez de excluir.` };
  }
  const { error } = await supabase.from("niches").delete().eq("id", id);
  if (error) return { ok: false, error: "Não foi possível excluir." };
  refresh();
  return { ok: true };
}

// ---------------------------------------------------------------------
// PARTE 3 — Serviços sugeridos
// ---------------------------------------------------------------------
export async function saveTemplate(input: {
  id?: string;
  niche_id: string;
  name: string;
  category: string;
  description: string;
  duration_min: number;
  price: number;
  sort_order: number;
}): Promise<Result> {
  const supabase = await adminClient();
  if (!supabase) return { ok: false, error: "Acesso negado." };

  if (input.name.trim().length < 2) return { ok: false, error: "Informe o nome do serviço." };
  if (!(input.duration_min >= 5 && input.duration_min <= 600)) return { ok: false, error: "Duração entre 5 e 600 minutos." };
  if (!(input.price >= 0)) return { ok: false, error: "Preço inválido." };

  const row = {
    niche_id: input.niche_id,
    name: input.name.trim(),
    category: input.category.trim() || null,
    description: input.description.trim() || null,
    duration_min: Math.round(input.duration_min),
    price: Math.round(input.price * 100) / 100,
    sort_order: Math.round(input.sort_order) || 0,
  };

  const { error } = input.id
    ? await supabase.from("niche_service_templates").update(row).eq("id", input.id)
    : await supabase.from("niche_service_templates").insert(row);
  if (error) return { ok: false, error: "Não foi possível salvar o serviço sugerido." };

  refresh();
  return { ok: true };
}

export async function deleteTemplate(id: string): Promise<Result> {
  const supabase = await adminClient();
  if (!supabase) return { ok: false, error: "Acesso negado." };
  const { error } = await supabase.from("niche_service_templates").delete().eq("id", id);
  if (error) return { ok: false, error: "Não foi possível excluir." };
  refresh();
  return { ok: true };
}
