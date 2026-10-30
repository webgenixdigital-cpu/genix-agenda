// Catálogo de nichos (administrado pela Genix no banco)
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { createPublicClient } from "@/lib/supabase/public";
import type { Segment } from "@/lib/types";

export type Niche = {
  id: string;
  segment: Segment;
  name: string;
  description: string | null;
  icon: string;
  sort_order: number;
};

/** Nichos ativos, na ordem definida pela Genix (só no servidor) */
export const getActiveNiches = cache(async (): Promise<Niche[]> => {
  const supabase = createClient();
  const { data } = await supabase
    .from("niches")
    .select("id, segment, name, description, icon, sort_order")
    .eq("active", true)
    .order("sort_order");
  return (data ?? []) as Niche[];
});

/**
 * Nichos dos círculos da página principal: ativos com destaque, pela ordem do
 * destaque. Sem nenhum marcado, os 8 primeiros por sort_order.
 * Usa o cliente público (sem cookies) para a "/" poder ter cache.
 */
export async function getFeaturedNiches(): Promise<Niche[]> {
  const supabase = createPublicClient();
  const { data, error } = await supabase
    .from("niches")
    .select("id, segment, name, description, icon, sort_order, featured, featured_order")
    .eq("active", true)
    .order("sort_order");
  if (error) {
    // sem as colunas da migration 26 (ainda não aplicada): cai nos 8 primeiros
    const { data: base } = await supabase
      .from("niches")
      .select("id, segment, name, description, icon, sort_order")
      .eq("active", true)
      .order("sort_order")
      .limit(8);
    return (base ?? []) as Niche[];
  }
  const all = data ?? [];
  const featured = all
    .filter((n) => n.featured)
    .sort((a, b) => (a.featured_order ?? 999) - (b.featured_order ?? 999) || a.sort_order - b.sort_order);
  const list = featured.length > 0 ? featured : all.slice(0, 8);
  return list.map((n) => ({
    id: n.id,
    segment: n.segment,
    name: n.name,
    description: n.description,
    icon: n.icon,
    sort_order: n.sort_order,
  })) as Niche[];
}
