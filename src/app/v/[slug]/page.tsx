import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AtSign, Clock, MapPin, MessageCircle, Star } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { SiteHeader } from "@/components/site-header";
import { BookTrigger } from "@/components/vitrine/book-trigger";
import { BookingWizard } from "@/components/vitrine/booking-wizard";
import { Button } from "@/components/ui/button";
import { brl, duration, hhmm, whatsappLink, WEEKDAYS } from "@/lib/format";
import type { Business, BusinessHour, Professional, Service } from "@/lib/types";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

type Props = { params: { slug: string } };

// ---------------------------------------------------------------------
// PARTE 1 — Carregamento dos dados (tudo em paralelo)
// ---------------------------------------------------------------------
async function loadVitrine(slug: string) {
  const supabase = createClient();

  const { data: business } = await supabase
    .from("businesses")
    .select("id, slug, name, segment, subcategory, tagline, description, phone, whatsapp, whatsapp_message, address, city, state, instagram, logo_url, hero_image")
    .eq("slug", slug)
    .eq("is_published", true)
    .maybeSingle();

  if (!business) return null;

  const [services, professionals, hours, reviews, rating, niche] = await Promise.all([
    supabase.from("services").select("id, name, description, category, price, duration_min, image_url, sort_order, bookable_online")
      .eq("business_id", business.id).eq("active", true).order("sort_order"),
    supabase.from("professionals").select("id, name, role, bio, photo_url, specialties")
      .eq("business_id", business.id).eq("active", true).order("sort_order"),
    supabase.from("business_hours").select("weekday, open_time, close_time, closed")
      .eq("business_id", business.id).order("weekday"),
    supabase.from("reviews").select("id, author_name, rating, comment, created_at")
      .eq("business_id", business.id).eq("visible", true).order("created_at", { ascending: false }).limit(6),
    supabase.from("public_directory").select("rating_avg, rating_count").eq("id", business.id).maybeSingle(),
    supabase.from("niches").select("name").eq("id", business.subcategory ?? "").maybeSingle(),
  ]);

  return {
    business: {
      ...business,
      ...(rating.data ?? { rating_avg: 0, rating_count: 0 }),
      niche_name: niche.data?.name ?? null,
    } as Business,
    services: (services.data ?? []) as Service[],
    professionals: (professionals.data ?? []) as Professional[],
    hours: (hours.data ?? []) as BusinessHour[],
    reviews: reviews.data ?? [],
  };
}

function todayWeekday() {
  const d = new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", weekday: "short" }).format(new Date());
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(d);
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const data = await loadVitrine(params.slug);
  if (!data) return { title: "Página não encontrada" };
  return {
    title: `${data.business.name} | Agende online`,
    description: data.business.tagline ?? data.business.description ?? undefined,
  };
}

// ---------------------------------------------------------------------
// PARTE 2 — Página
// ---------------------------------------------------------------------
export default async function VitrinePage({ params }: Props) {
  const data = await loadVitrine(params.slug);
  if (!data) notFound();

  const { business: b, services, professionals, hours, reviews } = data;
  const wa = whatsappLink(b.whatsapp, b.whatsapp_message ?? undefined);
  const today = todayWeekday();
  const todayHours = hours.find((h) => h.weekday === today);
  const onlineServices = services.filter((s) => s.bookable_online);

  // agrupa serviços por categoria, mantendo a ordem
  const groups = services.reduce<Record<string, Service[]>>((acc, s) => {
    const key = s.category ?? "Serviços";
    (acc[key] ??= []).push(s);
    return acc;
  }, {});

  return (
    <>
      <SiteHeader />

      <main className="pb-24 md:pb-0">
        {/* ---------- HERO ---------- */}
        <section className="relative isolate overflow-hidden">
          {b.hero_image && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={b.hero_image} alt="" className="absolute inset-0 -z-10 h-full w-full object-cover" />
          )}
          <div className="absolute inset-0 -z-10 bg-[linear-gradient(180deg,rgba(28,25,23,0.78)_0%,rgba(28,25,23,0.88)_100%)]" />

          <div className="mx-auto max-w-6xl px-4 py-14 text-white md:px-6 md:py-20">
            <p className="text-sm font-medium text-[#F2C078]">{b.niche_name}</p>
            <h1 className="mt-2 max-w-3xl text-4xl leading-[1.08] md:text-[56px]">{b.name}</h1>
            {b.tagline && <p className="mt-4 max-w-xl text-lg text-stone-200">{b.tagline}</p>}

            <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-stone-200">
              {b.rating_count > 0 && (
                <span className="inline-flex items-center gap-1.5">
                  <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
                  <strong className="text-white">{Number(b.rating_avg).toFixed(1)}</strong>
                  ({b.rating_count} avaliações)
                </span>
              )}
              {b.city && (
                <span className="inline-flex items-center gap-1.5">
                  <MapPin className="h-4 w-4" /> {b.city}{b.state ? `, ${b.state}` : ""}
                </span>
              )}
              {todayHours && (
                <span className="inline-flex items-center gap-1.5">
                  <Clock className="h-4 w-4" />
                  {todayHours.closed
                    ? "Fechado hoje"
                    : `Hoje das ${hhmm(todayHours.open_time)} às ${hhmm(todayHours.close_time)}`}
                </span>
              )}
            </div>

            <div className="mt-8 flex flex-wrap gap-3">
              {onlineServices.length > 0 && (
                <BookTrigger size="lg" className="h-12 px-7 text-base active:scale-95" data-testid="btn-agendar-online">
                  Agendar online
                </BookTrigger>
              )}
              {wa && (
                <Button asChild size="lg" className="h-12 bg-whatsapp px-6 text-base text-white hover:bg-whatsapp-hover active:scale-95">
                  <a href={wa} target="_blank" rel="noopener noreferrer" data-testid="btn-whatsapp-hero">
                    <MessageCircle className="mr-2 h-5 w-5" /> Chamar no WhatsApp
                  </a>
                </Button>
              )}
            </div>
          </div>
        </section>

        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 md:px-6 lg:grid-cols-[1fr_320px]">
          {/* ---------- COLUNA PRINCIPAL ---------- */}
          <div className="space-y-14">
            {b.description && (
              <p className="max-w-2xl text-lg leading-relaxed text-muted-foreground">{b.description}</p>
            )}

            {/* Serviços */}
            <section aria-labelledby="servicos">
              <h2 id="servicos" className="text-3xl">Serviços</h2>
              {services.length === 0 && (
                <p className="mt-4 text-muted-foreground">Os serviços deste espaço ainda não foram cadastrados.</p>
              )}
              <div className="mt-6 space-y-10">
                {Object.entries(groups).map(([category, list]) => (
                  <div key={category}>
                    <h3 className="mb-3 font-sans text-sm font-semibold text-muted-foreground">{category}</h3>
                    <ul className="divide-y rounded-2xl border bg-card">
                      {list.map((s) => (
                        <li key={s.id} className="flex items-center gap-4 p-4 md:p-5">
                          <div className="min-w-0 flex-1">
                            <p className="font-semibold">{s.name}</p>
                            {s.description && <p className="mt-0.5 text-sm text-muted-foreground">{s.description}</p>}
                            <p className="mt-1.5 text-sm">
                              <strong>{brl(s.price)}</strong>
                              <span className="text-muted-foreground"> / {duration(s.duration_min)}</span>
                            </p>
                          </div>

                          {s.bookable_online ? (
                            <BookTrigger
                              serviceId={s.id}
                              variant="outline"
                              className="h-11 shrink-0 active:scale-95"
                              data-testid={`btn-agendar-servico-${s.id}`}
                            >
                              Agendar
                            </BookTrigger>
                          ) : b.whatsapp ? (
                            <Button asChild variant="outline" className="h-11 shrink-0">
                              <a
                                href={whatsappLink(b.whatsapp, `Olá! Quero agendar: ${s.name}`) ?? "#"}
                                target="_blank"
                                rel="noopener noreferrer"
                                data-testid={`btn-agendar-whatsapp-${s.id}`}
                              >
                                Agendar pelo WhatsApp
                              </a>
                            </Button>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </section>

            {/* Profissionais */}
            {professionals.length > 0 && (
              <section aria-labelledby="equipe">
                <h2 id="equipe" className="text-3xl">Equipe</h2>
                <div className="mt-6 grid gap-4 sm:grid-cols-2">
                  {professionals.map((p) => (
                    <div key={p.id} className="flex gap-4 rounded-2xl border bg-card p-5">
                      <div className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-full bg-secondary font-heading text-xl text-primary">
                        {p.photo_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={p.photo_url} alt={p.name} className="h-full w-full object-cover" />
                        ) : (
                          p.name.charAt(0)
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="font-semibold">{p.name}</p>
                        {p.role && <p className="text-sm text-primary">{p.role}</p>}
                        {p.bio && <p className="mt-1.5 text-sm text-muted-foreground">{p.bio}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Avaliações */}
            {reviews.length > 0 && (
              <section aria-labelledby="avaliacoes">
                <h2 id="avaliacoes" className="text-3xl">O que dizem os clientes</h2>
                <div className="mt-6 grid gap-4 sm:grid-cols-2">
                  {reviews.map((r) => (
                    <figure key={r.id} className="rounded-2xl bg-secondary/70 p-5">
                      <div className="flex gap-0.5" aria-label={`${r.rating} de 5 estrelas`}>
                        {Array.from({ length: 5 }).map((_, i) => (
                          <Star
                            key={i}
                            className={cn("h-4 w-4", i < r.rating ? "fill-amber-500 text-amber-500" : "text-stone-300")}
                          />
                        ))}
                      </div>
                      {r.comment && <blockquote className="mt-3 leading-relaxed">{r.comment}</blockquote>}
                      <figcaption className="mt-3 text-sm text-muted-foreground">{r.author_name}</figcaption>
                    </figure>
                  ))}
                </div>
              </section>
            )}
          </div>

          {/* ---------- LATERAL ---------- */}
          <aside className="space-y-6 lg:sticky lg:top-24 lg:self-start">
            <div className="rounded-2xl border bg-card p-5">
              <h2 className="font-sans text-base font-semibold">Horário de funcionamento</h2>
              <ul className="mt-3 space-y-1.5 text-sm">
                {hours.map((h) => (
                  <li
                    key={h.weekday}
                    className={cn(
                      "flex justify-between rounded-md px-2 py-1",
                      h.weekday === today && "bg-secondary font-semibold"
                    )}
                  >
                    <span>{WEEKDAYS[h.weekday]}</span>
                    <span className={cn(h.closed && "text-muted-foreground")}>
                      {h.closed ? "Fechado" : `${hhmm(h.open_time)} – ${hhmm(h.close_time)}`}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            {(b.address || b.instagram) && (
              <div className="space-y-3 rounded-2xl border bg-card p-5 text-sm">
                {b.address && (
                  <a
                    href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${b.address}, ${b.city ?? ""}`)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex gap-2 hover:underline"
                  >
                    <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    <span>{b.address}{b.city ? `, ${b.city}` : ""}{b.state ? ` - ${b.state}` : ""}</span>
                  </a>
                )}
                {b.instagram && (
                  <a
                    href={`https://instagram.com/${b.instagram.replace("@", "")}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 hover:underline"
                  >
                    <AtSign className="h-4 w-4 text-primary" /> {b.instagram.replace("@", "")}
                  </a>
                )}
              </div>
            )}
          </aside>
        </div>
      </main>

      <BookingWizard
        slug={b.slug}
        businessName={b.name}
        whatsapp={b.whatsapp}
        services={onlineServices}
        professionals={professionals}
        hours={hours}
      />

      {/* WhatsApp flutuante */}
      {wa && (
        <a
          href={wa}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Conversar no WhatsApp"
          data-testid="btn-whatsapp-flutuante"
          className="fixed bottom-5 right-5 z-40 grid h-14 w-14 place-items-center rounded-full bg-whatsapp text-white shadow-lg transition-transform hover:bg-whatsapp-hover active:scale-95"
        >
          <MessageCircle className="h-7 w-7" />
        </a>
      )}
    </>
  );
}
