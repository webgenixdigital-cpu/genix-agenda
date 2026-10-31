import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, Check, MapPin, Search, Store } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { BusinessCard } from "@/components/business-card";
import { NicheHighlights } from "@/components/niche-highlights";
import { NicheIcon } from "@/components/niche-icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getActiveNiches } from "@/lib/niches";
import type { DirectoryItem } from "@/lib/types";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

type Props = { params: { nicho: string }; searchParams: { local?: string } };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const n = (await getActiveNiches()).find((x) => x.id === params.nicho);
  if (!n) return { title: "Página não encontrada" };
  return {
    title: `${n.name} perto de você | Agende online no Genix Agenda`,
    description: `Encontre ${n.name.toLowerCase()} na sua cidade, veja preços e avaliações e agende online em poucos toques.`,
  };
}

const PRO_PERKS = ["Vitrine com agendamento 24h", "Agenda e acesso para a equipe", "Financeiro e lembretes no WhatsApp"];

// ---------------------------------------------------------------------
// PARTE 1 — Dados
// ---------------------------------------------------------------------
export default async function ExplorarNichoPage({ params, searchParams }: Props) {
  const niches = await getActiveNiches();
  const niche = niches.find((n) => n.id === params.nicho);
  if (!niche) notFound();

  const local = (searchParams.local ?? "").replace(/[,()%]/g, " ").trim().slice(0, 60);
  const supabase = createClient();

  let query = supabase
    .from("public_directory")
    .select("*")
    .eq("subcategory", niche.id)
    .order("rating_avg", { ascending: false })
    .order("rating_count", { ascending: false });
  if (local) query = query.or(`city.ilike.%${local}%,address.ilike.%${local}%,state.ilike.%${local}%`);

  const [{ data, error }, { data: cityRows }] = await Promise.all([
    query,
    supabase.from("public_directory").select("city, state").eq("subcategory", niche.id),
  ]);
  const items = (data ?? []) as DirectoryItem[];

  // cidades que já têm espaços deste segmento (atalhos)
  const cities = Array.from(
    new Map(
      (cityRows ?? [])
        .filter((r) => r.city)
        .map((r) => [`${r.city}|${r.state ?? ""}`, { city: r.city as string, state: r.state as string | null }])
    ).values()
  ).sort((a, b) => a.city.localeCompare(b.city, "pt-BR"));

  // -------------------------------------------------------------------
  // PARTE 2 — Página
  // -------------------------------------------------------------------
  return (
    <>
      <SiteHeader />

      <main className="pb-28 md:pb-0">
        {/* ---------- TOPO ---------- */}
        <section className="border-b bg-secondary/60">
          <div className="mx-auto max-w-6xl px-4 pb-14 pt-10 md:px-6 md:pb-20">
            <NicheHighlights niches={niches} activeId={niche.id} />

            <div className="mt-10 flex flex-col items-center gap-4 text-center">
              <span className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
                <NicheIcon name={niche.icon} className="h-7 w-7" />
              </span>
              <div>
                <h1 className="text-3xl leading-tight md:text-5xl">{niche.name}</h1>
                {niche.description && <p className="copy mt-2 text-muted-foreground">{niche.description}</p>}
              </div>
            </div>

            {/* Onde você está? */}
            <form action={`/explorar/${niche.id}`} className="mx-auto mt-10 max-w-xl" role="search">
              <label htmlFor="local" className="text-sm font-semibold">Onde você está?</label>
              <div className="mt-2 flex gap-2">
                <div className="relative flex-1">
                  <MapPin className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-primary" />
                  <Input
                    id="local"
                    name="local"
                    defaultValue={local}
                    placeholder="Cidade ou bairro"
                    autoComplete="address-level2"
                    className="h-12 bg-white pl-10 text-base"
                    data-testid="input-local"
                  />
                </div>
                <Button type="submit" className="h-12 px-5" data-testid="btn-buscar-local">
                  <Search className="h-5 w-5 sm:mr-2" />
                  <span className="hidden sm:inline">Buscar</span>
                </Button>
              </div>
            </form>

            {cities.length > 0 && (
              <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
                <span className="text-sm text-muted-foreground">Cidades com {niche.name.toLowerCase()}:</span>
                {cities.slice(0, 8).map((c) => {
                  const active = local && c.city.toLowerCase() === local.toLowerCase();
                  return (
                    <Link
                      key={`${c.city}-${c.state}`}
                      href={`/explorar/${niche.id}?local=${encodeURIComponent(c.city)}#resultados`}
                      className={cn(
                        "inline-flex h-9 items-center rounded-full border px-3 text-sm transition-colors",
                        active ? "border-primary bg-primary text-primary-foreground" : "bg-white hover:border-primary/50"
                      )}
                    >
                      {c.city}{c.state ? `/${c.state}` : ""}
                    </Link>
                  );
                })}
                {local && (
                  <Link href={`/explorar/${niche.id}#resultados`} className="text-sm text-primary underline">
                    Limpar
                  </Link>
                )}
              </div>
            )}
          </div>
        </section>

        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 md:px-6 lg:grid-cols-[1fr_300px]">
          {/* ---------- RESULTADOS ---------- */}
          <section id="resultados" className="scroll-mt-20">
            <h2 className="text-2xl">
              {local ? `${niche.name} em ${local}` : `${niche.name} no Genix`}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {items.length === 1 ? "1 espaço encontrado" : `${items.length} espaços encontrados`}
            </p>

            {error && (
              <p className="mt-6 rounded-xl border border-destructive/40 bg-white p-4 text-sm text-destructive">
                Não foi possível carregar os espaços agora. Recarregue a página em alguns segundos.
              </p>
            )}

            {!error && items.length === 0 ? (
              <div className="mt-6 rounded-2xl border border-dashed bg-white p-8 text-center">
                <p className="font-heading text-2xl">
                  {local ? `Ainda não há ${niche.name.toLowerCase()} em ${local}` : "Ainda não há espaços neste segmento"}
                </p>
                <p className="mx-auto mt-2 max-w-md text-muted-foreground">
                  {local ? "Tente uma cidade vizinha ou busque sem filtro." : "Volte em breve."} Conhece um profissional
                  que atende aqui? Indique o Genix Agenda para ele.
                </p>
                {local && (
                  <Button asChild variant="outline" className="mt-5">
                    <Link href={`/explorar/${niche.id}#resultados`}>Ver todas as cidades</Link>
                  </Button>
                )}
              </div>
            ) : (
              <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2">
                {items.map((b) => <BusinessCard key={b.id} b={b} />)}
              </div>
            )}
          </section>

          {/* ---------- SOU PROFISSIONAL (lateral no computador) ---------- */}
          <aside className="hidden lg:block">
            <div className="sticky top-24 rounded-2xl bg-foreground p-6 text-background" data-testid="card-sou-profissional">
              <Store className="h-7 w-7 text-[#F2C078]" />
              <p className="mt-3 font-heading text-2xl leading-tight">Sou profissional de {niche.name.toLowerCase()}</p>
              <ul className="mt-4 space-y-2 text-sm text-stone-300">
                {PRO_PERKS.map((p) => (
                  <li key={p} className="flex gap-2">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#F2C078]" /> {p}
                  </li>
                ))}
              </ul>
              <Button asChild className="mt-6 h-11 w-full" data-testid="btn-sou-profissional">
                <Link href={`/para/${niche.id}`}>
                  Conhecer o Genix <ArrowRight className="ml-1.5 h-4 w-4" />
                </Link>
              </Button>
              <p className="mt-2 text-center text-xs text-stone-400">15 dias grátis, sem cartão</p>
            </div>
          </aside>
        </div>
      </main>

      {/* ---------- SOU PROFISSIONAL (barra fixa no celular) ---------- */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-white/95 p-3 backdrop-blur lg:hidden">
        <Button asChild variant="outline" className="h-12 w-full border-primary text-base" data-testid="btn-sou-profissional-mobile">
          <Link href={`/para/${niche.id}`}>
            <Store className="mr-2 h-5 w-5 text-primary" /> Sou profissional de {niche.name.toLowerCase()}
          </Link>
        </Button>
      </div>

      <SiteFooter />
    </>
  );
}
