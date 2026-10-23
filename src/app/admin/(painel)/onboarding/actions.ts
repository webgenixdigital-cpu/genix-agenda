"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getEditorContext } from "@/lib/admin";

type Result = { ok: true; message?: string } | { ok: false; error: string };

const STEP_KEYS = ["hours", "solo", "link", "shared"] as const;
export type ManualStep = (typeof STEP_KEYS)[number];

// ---------------------------------------------------------------------
// PARTE 1 — Marcar um passo manual ("Já conferi", "Trabalho sozinho"...)
// ---------------------------------------------------------------------
export async function markOnboardingStep(step: ManualStep): Promise<Result> {
  if (!STEP_KEYS.includes(step)) return { ok: false, error: "Passo inválido." };
  const { business } = await getEditorContext();
  const supabase = createClient();

  const { data } = await supabase.from("businesses").select("onboarding").eq("id", business.id).single();
  const onboarding = { ...((data?.onboarding as Record<string, boolean>) ?? {}), [step]: true };

  const { error } = await supabase.from("businesses").update({ onboarding }).eq("id", business.id);
  if (error) return { ok: false, error: "Só o dono do espaço pode concluir este passo." };

  revalidatePath("/admin");
  return { ok: true };
}

// ---------------------------------------------------------------------
// PARTE 2 — Fechar / reabrir o card
// ---------------------------------------------------------------------
export async function setOnboardingDismissed(dismissed: boolean): Promise<Result> {
  const { business } = await getEditorContext();
  const supabase = createClient();
  const { error } = await supabase.from("businesses").update({ onboarding_dismissed: dismissed }).eq("id", business.id);
  if (error) return { ok: false, error: "Não foi possível atualizar." };
  revalidatePath("/admin");
  return { ok: true };
}

// ---------------------------------------------------------------------
// PARTE 3 — Adicionar serviços sugeridos do segmento (sem duplicar nomes)
// ---------------------------------------------------------------------
export async function addSuggestedServices(): Promise<Result> {
  const { business } = await getEditorContext();
  const supabase = createClient();

  // nicho do espaço; sem nicho, usa o primeiro nicho do mesmo segmento
  let nicheId = business.subcategory;
  if (!nicheId) {
    const { data: first } = await supabase
      .from("niches").select("id").eq("segment", business.segment).eq("active", true)
      .order("sort_order").limit(1).maybeSingle();
    nicheId = first?.id ?? null;
  }
  const { data: tpl } = await supabase
    .from("niche_service_templates")
    .select("name, category, description, duration_min, price")
    .eq("niche_id", nicheId ?? "")
    .order("sort_order");
  const templates = tpl ?? [];
  if (templates.length === 0) return { ok: true, message: "Ainda não há serviços sugeridos para o seu tipo de espaço." };

  const { data: existing } = await supabase.from("services").select("name, sort_order").eq("business_id", business.id);
  const names = new Set((existing ?? []).map((s) => s.name.toLowerCase()));
  let order = Math.max(0, ...(existing ?? []).map((s) => s.sort_order ?? 0));

  const rows = templates
    .filter((t) => !names.has(t.name.toLowerCase()))
    .map((t) => ({ ...t, business_id: business.id, sort_order: ++order }));

  if (rows.length === 0) return { ok: true, message: "Os serviços sugeridos já estão cadastrados." };

  const { error } = await supabase.from("services").insert(rows);
  if (error) return { ok: false, error: "Não foi possível adicionar os serviços." };

  revalidatePath("/admin");
  revalidatePath("/admin/servicos");
  revalidatePath(`/v/${business.slug}`);
  return { ok: true, message: `${rows.length} serviços adicionados. Confira os preços em Serviços.` };
}
