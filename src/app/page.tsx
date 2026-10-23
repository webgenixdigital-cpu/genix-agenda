import Link from "next/link";
import { ArrowRight, CalendarCheck, MessageCircle, Search, Store } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { BusinessCard } from "@/components/business-card";
import { NicheIcon } from "@/components/niche-icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getActiveNiches } from "@/lib/niches";
import { SEGMENTS } from "@/lib/segments";
import type { DirectoryItem } from "@/lib/types";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

type Props = { searchParams: { nicho?: string; seg?: string; q?: string } };

const HOW = [
  { icon: Search, title: "Escolha o espaço", text: "Veja serviços, preços, equipe e avaliações de quem já foi." },
  { icon: CalendarCheck, title: "Marque o horário", text: "Só aparecem horários livres de verdade. Leva menos de 1 minuto." },
  { icon: MessageCircle, title: "Confirme no WhatsApp", text: "O espaço confirma e você recebe tudo pelo WhatsApp." },
];

// ---------------------------------------------------------------------
// PARTE 1 — Dados
// ---------------------------------------------------------------------
export default async function Home({ searchParams }: Props) {
  const niches = await getActiveNiches();
  const nicho = niches.find((n) => n.id === searchParams.nicho)?.id;
  const seg = SEGMENTS.some((s) => s.value === searchParams.seg) ? searchParams.seg : undefined;
  const q = (searchParams.q ?? "").replace(/[,()%]/g, " ").trim().slice(0, 60);
  const filtered = !!(nicho || seg || q);

  const supabase = createClient();
  let query = supabase
    .from("public_directory")
    .select("*")
    .order("rating_avg", { ascending: false })
    .order("rating_count", { ascending: false });
  if (nicho) query = query.eq("subcategory", nicho);
  else if (seg) query = query.eq("segment", seg);
  if (q) query = query.or(`name.ilike.%${q}%,city.ilike.%${q}%,niche_name.ilike.%${q}%`);

  const [{ data, error }, { data: all }] = await Promise.all([
    query,
    supabase.from("public_directory").select("subcategory"),
  ]);
  const items = (data ?? []) as DirectoryItem[];

  // quantos espaços por nicho (para os cards)
  const counts = new Map<string, number>();
  for (const r of all ?? []) if (r.subcategory) counts.set(r.subcategory, (counts.get(r.subcategory) ?? 0) + 1);

  const activeNiche = niches.find((n) => n.id === nicho);
  const chipHref = (id?: string) => {
    const p = new URLSearchParams();
    if (id) p.set("nicho", id);
    if (q) p.set("q", q);
    const s = p.toString();
    return s ? `/?${s}#resultados` : "/#resultados";
  };

  // -------------------------------------------------------------------
  // PARTE 2 — Página
  // -------------------------------------------------------------------
  return (
    <>
      <SiteHeader />

      <main>
        {/* ---------- HERO + BUSCA ---------- */}
        <section className="border-b bg-secondary/60">
          <div className="mx-auto max-w-6xl px-4 py-14 md:px-6 md:py-20">
            <h1 className="max-w-2xl text-4xl leading-[1.08] md:text-[56px]">
              Encontre quem cuida de você e agende em poucos toques
            </h1>
            <p className="mt-4 max-w-xl text-lg text-muted-foreground">
              Salões, barbearias, estética, unhas, cílios e muito mais, com horários abertos agora.
            </p>

            <form action="/" className="mt-8 flex max-w-xl gap-2" role="search">
              {nicho && <input type="hidden" name="nicho" value={nicho} />}
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
              <Button type="submit" className="h-12 px-6" data-testid="btn-buscar">Buscar</Button>
            </form>

            {/* Atalhos por nicho */}
            <nav className="-mx-4 mt-6 flex gap-2 overflow-x-auto px-4 pb-2 md:mx-0 md:flex-wrap md:px-0" aria-label="Filtrar por tipo de atendimento">
              <Link
                href={chipHref()}
                className={cn(
                  "inline-flex h-11 shrink-0 items-center rounded-full border px-4 text-sm font-medium transition-colors",
                  !nicho ? "border-primary bg-primary text-primary-foreground" : "bg-white hover:border-primary/50"
                )}
                data-testid="filtro-nicho-todos"
              >
                Todos
              </Link>
              {niches.map((n) => (
                <Link
                  key={n.id}
                  href={chipHref(n.id)}
                  className={cn(
                    "inline-flex h-11 shrink-0 items-center gap-2 rounded-full border px-4 text-sm font-medium transition-colors",
                    nicho === n.id ? "border-primary bg-primary text-primary-foreground" : "bg-white hover:border-primary/50"
                  )}
                  data-testid={`filtro-nicho-${n.id}`}
                >
                  <NicheIcon name={n.icon} className="h-4 w-4" />
                  {n.name}
                </Link>
              ))}
            </nav>
          </div>
        </section>

        {/* ---------- RESULTADOS ---------- */}
        <section id="resultados" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-12 md:px-6">
          <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-3xl">{activeNiche ? activeNiche.name : filtered ? "Resultados" : "Espaços em destaque"}</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {items.length === 1 ? "1 espaço encontrado" : `${items.length} espaços encontrados`}
                {q && <> para “{q}”</>}
              </p>
            </div>
            {activeNiche && (
              <Link href={`/para/${activeNiche.id}`} className="inline-flex items-center gap-1 text-sm font-semibold text-primary underline">
                Trabalha com {activeNiche.name.toLowerCase()}? Conheça o Genix <ArrowRight className="h-4 w-4" />
              </Link>
            )}
          </div>

          {error && (
            <p className="rounded-xl border border-destructive/40 bg-white p-4 text-sm text-destructive">
              Não foi possível carregar os espaços agora. Recarregue a página em alguns segundos.
            </p>
          )}

          {!error && items.length === 0 && (
            <div className="rounded-2xl border border-dashed bg-white p-10 text-center">
              <p className="font-heading text-2xl">Nenhum espaço com esse filtro ainda</p>
              <p className="mt-2 text-muted-foreground">Tente outro termo ou veja todos os tipos de atendimento.</p>
              <Button asChild variant="outline" className="mt-5"><Link href="/">Ver todos</Link></Button>
            </div>
          )}

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 md:gap-8 lg:grid-cols-3">
            {items.map((b) => <BusinessCard key={b.id} b={b} />)}
          </div>
        </section>

        {/* ---------- COMO AGENDAR ---------- */}
        <section className="border-y bg-secondary/50">
          <div className="mx-auto max-w-6xl px-4 py-14 md:px-6">
            <h2 className="text-3xl md:text-[42px]">Como agendar</h2>
            <ol className="mt-8 grid gap-6 md:grid-cols-3">
              {HOW.map(({ icon: Icon, title, text }, i) => (
                <li key={title} className="rounded-2xl bg-white p-6">
                  <span className="flex items-center gap-3">
                    <span className="grid h-11 w-11 place-items-center rounded-full bg-primary text-primary-foreground">
                      <Icon className="h-5 w-5" />
                    </span>
                    <span className="font-heading text-3xl text-primary/40">{i + 1}</span>
                  </span>
                  <p className="mt-4 text-lg font-semibold">{title}</p>
                  <p className="mt-1 text-muted-foreground">{text}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* ---------- NICHOS ---------- */}
        <section className="mx-auto max-w-6xl px-4 py-14 md:px-6" aria-labelledby="nichos">
          <h2 id="nichos" className="max-w-2xl text-3xl md:text-[42px] md:leading-tight">Para cada tipo de atendimento</h2>
          <p className="mt-3 max-w-2xl text-muted-foreground">
            Clientes encontram e agendam. Profissionais organizam a agenda, a equipe e o caixa num só lugar.
          </p>

          <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {niches.map((n) => {
              const c = counts.get(n.id) ?? 0;
              return (
                <li key={n.id} className="flex flex-col rounded-2xl border bg-card p-5" data-testid={`card-nicho-${n.id}`}>
                  <div className="flex items-start gap-3">
                    <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-secondary text-primary">
                      <NicheIcon name={n.icon} className="h-6 w-6" />
                    </span>
                    <div>
                      <h3 className="font-sans text-lg font-semibold">{n.name}</h3>
                      {n.description && <p className="mt-0.5 text-sm text-muted-foreground">{n.description}</p>}
                    </div>
                  </div>
                  <div className="mt-auto flex flex-wrap gap-2 pt-5">
                    <Button asChild size="sm" className="h-10" variant={c > 0 ? "default" : "outline"}>
                      <Link href={chipHref(n.id)}>
                        {c > 0 ? `Ver ${c} ${c === 1 ? "espaço" : "espaços"}` : "Ver espaços"}
                      </Link>
                    </Button>
                    <Button asChild size="sm" variant="ghost" className="h-10" data-testid={`link-para-${n.id}`}>
                      <Link href={`/para/${n.id}`}>
                        <Store className="mr-1.5 h-4 w-4" /> Sou deste ramo
                      </Link>
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>

        {/* ---------- FAIXA PROFISSIONAL ---------- */}
        <section className="bg-foreground text-background">
          <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-6 px-4 py-12 md:flex-row md:items-center md:px-6">
            <div>
              <h2 className="text-3xl">Você atende com hora marcada?</h2>
              <p className="mt-2 max-w-xl text-stone-300">
                Tenha sua vitrine com agendamento online, lembretes por WhatsApp e financeiro. 15 dias grátis, sem cartão.
              </p>
            </div>
            <Button asChild size="lg" className="h-12 shrink-0 px-7 text-base" data-testid="btn-home-profissional">
              <Link href="/profissional">Conhecer o Genix Agenda</Link>
            </Button>
          </div>
        </section>
      </main>

      <SiteFooter />
    </>
  );
}
