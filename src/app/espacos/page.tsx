import Link from "next/link";
import { ArrowRight, CalendarCheck, MessageCircle, Search, Store, X } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { BusinessCard } from "@/components/business-card";
import { NicheIcon } from "@/components/niche-icon";
import { Button } from "@/components/ui/button";
import { NicheSearch } from "@/components/espacos/niche-search";
import { getActiveNiches } from "@/lib/niches";
import { matchNiches } from "@/lib/niche-match";
import { SEGMENTS } from "@/lib/segments";
import type { Metadata } from "next";
import type { DirectoryItem } from "@/lib/types";

export const metadata: Metadata = {
  title: "Encontre um espaço e agende online | Genix Agenda",
  description:
    "Salões, barbearias, estética, unhas, cílios e muito mais. Veja preços e avaliações e agende online em poucos toques.",
  alternates: { canonical: "/espacos" },
};

export const dynamic = "force-dynamic";

type Props = { searchParams: { nicho?: string; seg?: string; q?: string; onde?: string } };

// texto seguro para o filtro do PostgREST (vírgula e parênteses quebram o .or)
const clean = (s?: string) => (s ?? "").replace(/[,()%*]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);

const HOW = [
  { icon: Search, title: "Escolha o espaço", text: "Veja serviços, preços, equipe e avaliações de quem já foi." },
  { icon: CalendarCheck, title: "Marque o horário", text: "Só aparecem horários livres de verdade. Leva menos de 1 minuto." },
  { icon: MessageCircle, title: "Confirme no WhatsApp", text: "O espaço confirma e você recebe tudo pelo WhatsApp." },
];

// ---------------------------------------------------------------------
// PARTE 1 — Dados
// ---------------------------------------------------------------------
export default async function EspacosPage({ searchParams }: Props) {
  const niches = await getActiveNiches();
  const nicho = niches.find((n) => n.id === searchParams.nicho)?.id;
  const seg = SEGMENTS.some((s) => s.value === searchParams.seg) ? searchParams.seg : undefined;
  const q = clean(searchParams.q);
  const onde = clean(searchParams.onde);
  const filtered = !!(nicho || seg || q || onde);

  // texto livre que bate com o nome/sinônimo de um nicho também traz os espaços dele
  // (ex.: "cilios" → Lash designer), além da busca por nome, cidade e nicho
  const qNiches = q ? matchNiches(niches, q).map((n) => n.id) : [];
  const qFilter = q
    ? [
        `name.ilike.%${q}%`,
        `city.ilike.%${q}%`,
        `niche_name.ilike.%${q}%`,
        ...(qNiches.length ? [`subcategory.in.(${qNiches.join(",")})`] : []),
      ].join(",")
    : "";
  const ondeFilter = onde ? `name.ilike.%${onde}%,city.ilike.%${onde}%` : "";

  const supabase = createClient();
  let query = supabase
    .from("public_directory")
    .select("*")
    .order("rating_avg", { ascending: false })
    .order("rating_count", { ascending: false });
  if (nicho) query = query.eq("subcategory", nicho);
  else if (seg) query = query.eq("segment", seg);
  // q e onde valem juntos (E); cada um é um "ou" entre os seus campos
  if (qFilter && ondeFilter) query = query.or(`and(or(${qFilter}),or(${ondeFilter}))`);
  else if (qFilter) query = query.or(qFilter);
  else if (ondeFilter) query = query.or(ondeFilter);

  const [{ data, error }, { data: all }] = await Promise.all([
    query,
    supabase.from("public_directory").select("subcategory"),
  ]);
  const items = (data ?? []) as DirectoryItem[];

  // quantos espaços por nicho (para os cards)
  const counts = new Map<string, number>();
  for (const r of all ?? []) if (r.subcategory) counts.set(r.subcategory, (counts.get(r.subcategory) ?? 0) + 1);

  const activeNiche = niches.find((n) => n.id === nicho);
  const activeSeg = SEGMENTS.find((s) => s.value === seg);

  // link que tira um filtro e mantém os outros
  const hrefWithout = (key: "nicho" | "seg") => {
    const p = new URLSearchParams();
    if (key !== "nicho" && nicho) p.set("nicho", nicho);
    if (key !== "seg" && seg) p.set("seg", seg);
    if (q) p.set("q", q);
    if (onde) p.set("onde", onde);
    const qs = p.toString();
    return `/espacos${qs ? `?${qs}` : ""}#resultados`;
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

            {/* Busca: nicho (com sugestões) + onde */}
            <NicheSearch
              key={`${nicho ?? ""}|${q}|${onde}`}
              niches={niches.map((n) => ({ id: n.id, name: n.name, keywords: n.keywords, icon: n.icon }))}
              initialNiche={nicho}
              initialQ={q}
              initialOnde={onde}
              seg={seg}
            />

            {/* Filtros ativos (removíveis) */}
            {(activeNiche || activeSeg) && (
              <ul className="mt-4 flex flex-wrap gap-2" aria-label="Filtros ativos">
                {activeNiche && (
                  <li>
                    <Link
                      href={hrefWithout("nicho")}
                      className="inline-flex min-h-11 items-center gap-2 rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground"
                      aria-label={`Remover filtro ${activeNiche.name}`}
                      data-testid="filtro-nicho-remover"
                    >
                      {activeNiche.name} <X className="h-4 w-4" aria-hidden />
                    </Link>
                  </li>
                )}
                {activeSeg && !activeNiche && (
                  <li>
                    <Link
                      href={hrefWithout("seg")}
                      className="inline-flex min-h-11 items-center gap-2 rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground"
                      aria-label={`Remover filtro ${activeSeg.label}`}
                      data-testid="filtro-segmento-remover"
                    >
                      {activeSeg.label} <X className="h-4 w-4" aria-hidden />
                    </Link>
                  </li>
                )}
              </ul>
            )}
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
                {onde && <> em “{onde}”</>}
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
              <Button asChild variant="outline" className="mt-5"><Link href="/espacos">Ver todos</Link></Button>
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
                      <Link href={`/explorar/${n.id}`}>
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
                Vitrine e agenda online grátis para sempre para 1 profissional. E 15 dias do Completo para testar tudo, sem cartão.
              </p>
            </div>
            <Button asChild size="lg" className="h-12 shrink-0 px-7 text-base" data-testid="btn-home-profissional">
              <Link href="/">Conhecer o Genix Agenda</Link>
            </Button>
          </div>
        </section>
      </main>

      <SiteFooter />
    </>
  );
}
