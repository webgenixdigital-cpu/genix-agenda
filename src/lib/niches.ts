// Catálogo de nichos (administrado pela Genix no banco)
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
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
