import Link from "next/link";
import { Search } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { SiteHeader } from "@/components/site-header";
import { BusinessCard } from "@/components/business-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SEGMENTS } from "@/lib/segments";
import type { DirectoryItem } from "@/lib/types";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

type Props = { searchParams: { seg?: string; q?: string } };

export default async function Home({ searchParams }: Props) {
  const seg = SEGMENTS.some((s) => s.value === searchParams.seg) ? searchParams.seg : undefined;
  const q = (searchParams.q ?? "").replace(/[,()%]/g, " ").trim().slice(0, 60);

  const supabase = createClient();
  let query = supabase
    .from("public_directory")
    .select("*")
    .order("rating_avg", { ascending: false })
    .order("rating_count", { ascending: false });
  if (seg) query = query.eq("segment", seg);
  if (q) query = query.or(`name.ilike.%${q}%,city.ilike.%${q}%,subcategory.ilike.%${q}%`);
  const { data, error } = await query;
  const items = (data ?? []) as DirectoryItem[];

  const pillHref = (value?: string) => {
    const p = new URLSearchParams();
    if (value) p.set("seg", value);
    if (q) p.set("q", q);
    const s = p.toString();
    return s ? `/?${s}` : "/";
  };

  return (
    <>
      <SiteHeader />

      <main>
        {/* Hero */}
        <section className="border-b bg-secondary/60">
          <div className="mx-auto max-w-6xl px-4 py-14 md:px-6 md:py-20">
            <h1 className="max-w-2xl text-4xl leading-[1.08] md:text-[56px]">
              Encontre quem cuida de você e agende em poucos toques
            </h1>
            <p className="mt-4 max-w-xl text-lg text-muted-foreground">
              Salões, barbearias, clínicas de estética e terapeutas com horários abertos agora.
            </p>

            <form action="/" className="mt-8 flex max-w-xl gap-2" role="search">
              {seg && <input type="hidden" name="seg" value={seg} />}
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  name="q"
                  defaultValue={q}
                  placeholder="Nome, cidade ou tipo de serviço"
                  className="h-12 bg-white pl-10 text-base"
                  data-testid="input-busca"
                />
              </div>
              <Button type="submit" className="h-12 px-6" data-testid="btn-buscar">
                Buscar
              </Button>
            </form>

            <nav className="mt-6 flex flex-wrap gap-2" aria-label="Filtrar por segmento">
              {[{ value: undefined, label: "Todos" }, ...SEGMENTS].map((s) => {
                const active = s.value === seg;
                return (
                  <Link
                    key={s.label}
                    href={pillHref(s.value)}
                    data-testid={`filter-segment-${s.value ?? "todos"}`}
                    className={cn(
                      "inline-flex h-10 items-center rounded-full border px-4 text-sm font-medium transition-colors",
                      active
                        ? "border-primary bg-primary text-primary-foreground"
                        : "bg-white hover:border-primary/50"
                    )}
                  >
                    {s.label}
                  </Link>
                );
              })}
            </nav>
          </div>
        </section>

        {/* Resultados */}
        <section className="mx-auto max-w-6xl px-4 py-12 md:px-6">
          <p className="mb-6 text-sm text-muted-foreground">
            {items.length === 1 ? "1 espaço encontrado" : `${items.length} espaços encontrados`}
            {q && <> para “{q}”</>}
          </p>

          {error && (
            <p className="rounded-xl border border-destructive/40 bg-white p-4 text-sm text-destructive">
              Não foi possível carregar os espaços agora. Recarregue a página em alguns segundos.
            </p>
          )}

          {!error && items.length === 0 && (
            <div className="rounded-2xl border border-dashed bg-white p-10 text-center">
              <p className="font-heading text-2xl">Nenhum espaço com esse filtro</p>
              <p className="mt-2 text-muted-foreground">Tente outro termo ou veja todos os segmentos.</p>
              <Button asChild variant="outline" className="mt-5">
                <Link href="/">Ver todos</Link>
              </Button>
            </div>
          )}

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 md:gap-8 lg:grid-cols-3">
            {items.map((b) => (
              <BusinessCard key={b.id} b={b} />
            ))}
          </div>
        </section>
      </main>

      <footer className="border-t py-8 text-center text-sm text-muted-foreground">
        Genix Agenda, um produto Genix Sistemas Integrativos
      </footer>
    </>
  );
}
