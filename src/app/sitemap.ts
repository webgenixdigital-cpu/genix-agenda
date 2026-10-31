import type { MetadataRoute } from "next";
import { createPublicClient } from "@/lib/supabase/public";

// Sitemap para o Google (/sitemap.xml). Cliente público (sem cookies): pode ter cache.
export const revalidate = 3600;

const BASE = "https://genixagenda.com.br";

// ---------------------------------------------------------------------
// PARTE 1 — Dados (erro numa consulta = aquela parte vazia; o sitemap nunca quebra)
// ---------------------------------------------------------------------
async function loadNiches() {
  const { data } = await createPublicClient()
    .from("niches")
    .select("id, updated_at")
    .eq("active", true)
    .order("sort_order");
  return (data ?? []) as { id: string; updated_at: string | null }[];
}

/** Vitrines publicadas, fora a demonstração e as ocultas pela Genix (search_hidden, migration 30) */
async function loadVitrines() {
  const { data, error } = await createPublicClient()
    .from("businesses")
    .select("slug, updated_at")
    .eq("is_published", true)
    .eq("is_demo", false)
    .eq("search_hidden", false)
    .order("slug");
  // sem a coluna (migration 30 ainda não aplicada): nenhuma vitrine, por segurança
  if (error) return [];
  return (data ?? []) as { slug: string; updated_at: string | null }[];
}

// ---------------------------------------------------------------------
// PARTE 2 — Sitemap
// ---------------------------------------------------------------------
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [niches, vitrines] = await Promise.all([loadNiches(), loadVitrines()]);
  const date = (d: string | null) => (d ? new Date(d) : undefined);

  return [
    ...["/", "/espacos", "/termos", "/privacidade"].map((path) => ({ url: `${BASE}${path}` })),
    ...niches.flatMap((n) => [
      { url: `${BASE}/para/${n.id}`, lastModified: date(n.updated_at) },
      { url: `${BASE}/explorar/${n.id}`, lastModified: date(n.updated_at) },
    ]),
    ...vitrines.map((v) => ({ url: `${BASE}/v/${v.slug}`, lastModified: date(v.updated_at) })),
  ];
}
