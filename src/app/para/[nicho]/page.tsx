import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  BellRing, CalendarCheck, CalendarOff, Check, ClipboardList, Link2, MessageCircle, PlayCircle, Sparkles, Users, Wallet,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { NicheIcon } from "@/components/niche-icon";
import { Pricing, type Plan } from "@/components/marketing/pricing";
import { Button } from "@/components/ui/button";
import { brl, duration } from "@/lib/format";
import { getActiveNiches } from "@/lib/niches";

export const revalidate = 3600;

type Props = { params: { nicho: string } };

async function findNiche(id: string) {
  return (await getActiveNiches()).find((n) => n.id === id) ?? null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const n = await findNiche(params.nicho);
  if (!n) return { title: "Página não encontrada" };
  return {
    title: `Agenda online para ${n.name} | Genix Agenda`,
    description: `Vitrine digital, agendamento online, equipe e financeiro para ${n.name.toLowerCase()}. Teste grátis por 15 dias, sem cartão.`,
  };
}

// ---------------------------------------------------------------------
// PARTE 1 — Conteúdo
// ---------------------------------------------------------------------
const STEPS = [
  { title: "Crie sua conta", text: "Em 2 minutos, sem cartão. Os serviços do seu segmento já entram prontos." },
  { title: "Ajuste e divulgue", text: "Confira preços e horários e coloque o link da vitrine na bio do Instagram." },
  { title: "Receba agendamentos", text: "Os clientes marcam sozinhos e você confirma com um toque no WhatsApp." },
];

const FEATURES = [
  { icon: Link2, title: "Vitrine com link próprio", text: "Serviços, preços, equipe e avaliações numa página para divulgar." },
  { icon: CalendarCheck, title: "Agendamento 24 horas", text: "Só aparecem horários livres de verdade, sem conflito." },
  { icon: Users, title: "Cada profissional com seu acesso", text: "Matriz vê tudo; cada profissional vê a própria agenda e os próprios ganhos." },
  { icon: ClipboardList, title: "Ficha do cliente", text: "Histórico de visitas e ficha técnica do seu segmento para cada cliente." },
  { icon: BellRing, title: "Lembretes pelo WhatsApp", text: "Fila de lembretes de véspera para reduzir as faltas." },
  { icon: CalendarOff, title: "Folgas e férias", text: "Bloqueie períodos e veja na hora quem precisa ser avisado." },
  { icon: Wallet, title: "Financeiro e comissões", text: "Caixa do dia, faturamento do mês e comissão estimada de cada profissional." },
  { icon: MessageCircle, title: "Avaliações dos clientes", text: "Link de avaliação após o atendimento, com as notas na sua vitrine." },
];

const TRUST = ["15 dias grátis", "Sem cartão", "Cancele quando quiser"];

// ---------------------------------------------------------------------
// PARTE 2 — Página
// ---------------------------------------------------------------------
export default async function NichoPage({ params }: Props) {
  const niche = await findNiche(params.nicho);
  if (!niche) notFound();

  const supabase = createClient();
  const [{ data: templates }, { data: plansData }, { count }] = await Promise.all([
    supabase.from("niche_service_templates").select("id, name, duration_min, price").eq("niche_id", niche.id).order("sort_order"),
    supabase.from("plans").select("id, name, billing_cycle, base_price, included_professionals, extra_professional_price").eq("active", true),
    supabase.from("public_directory").select("id", { count: "exact", head: true }).eq("subcategory", niche.id),
  ]);

  const plans = (plansData ?? []).map((p) => ({
    ...p,
    base_price: Number(p.base_price),
    extra_professional_price: Number(p.extra_professional_price),
  })) as Plan[];
  const services = templates ?? [];
  const preview = services.slice(0, 3);
  const signupHref = `/cadastro?nicho=${niche.id}`;
  const times = ["09:00", "10:30", "14:00"];

  return (
    <>
      <SiteHeader />

      <main className="pb-24 md:pb-0">
        {/* ---------- HERO EM DUAS COLUNAS ---------- */}
        <section className="border-b bg-secondary/60">
          <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-12 md:px-6 md:py-20 lg:grid-cols-[1.1fr_1fr]">
            <div>
              <span className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1.5 text-sm font-semibold text-primary ring-1 ring-primary/20">
                <NicheIcon name={niche.icon} className="h-4 w-4" /> Para {niche.name.toLowerCase()}
              </span>
              <h1 className="mt-5 text-4xl leading-[1.06] md:text-[56px]">
                Sua agenda de {niche.name.toLowerCase()} cheia, sem viver no WhatsApp.
              </h1>
              <p className="mt-5 max-w-xl text-lg text-muted-foreground">
                {niche.description} Vitrine com agendamento online, equipe, ficha do cliente e financeiro num só lugar.
              </p>

              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Button asChild size="lg" className="h-12 px-7 text-base active:scale-95" data-testid="btn-nicho-teste">
                  <Link href={signupHref}>Começar 15 dias grátis</Link>
                </Button>
                <Button asChild size="lg" variant="outline" className="h-12 bg-white px-6 text-base">
                  <Link href="/demo"><PlayCircle className="mr-2 h-5 w-5" /> Ver demonstração</Link>
                </Button>
              </div>

              <ul className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted-foreground">
                {TRUST.map((t) => (
                  <li key={t} className="flex items-center gap-1.5">
                    <Check className="h-4 w-4 text-primary" /> {t}
                  </li>
                ))}
              </ul>

              {(count ?? 0) > 0 && (
                <p className="mt-4 text-sm">
                  <Link href={`/explorar/${niche.id}`} className="font-semibold text-primary underline">
                    {count} {count === 1 ? "espaço" : "espaços"} de {niche.name.toLowerCase()}
                  </Link>{" "}
                  já recebem agendamentos pelo Genix.
                </p>
              )}
            </div>

            {/* Prévia da agenda com os serviços do segmento */}
            <div className="rounded-3xl border bg-white p-5 shadow-xl shadow-stone-900/5" aria-hidden>
              <div className="flex items-center justify-between">
                <p className="font-heading text-xl">Agenda de hoje</p>
                <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800 ring-1 ring-amber-600/30">
                  1 pedido novo
                </span>
              </div>
              <ul className="mt-4 divide-y">
                {(preview.length ? preview : [{ id: "x", name: "Atendimento", duration_min: 60, price: 100 }]).map((s, i) => (
                  <li key={s.id} className="flex items-center gap-3 py-3">
                    <span className="w-12 font-semibold">{times[i] ?? "16:00"}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{["Mariana R.", "Carla S.", "Juliana P."][i] ?? "Cliente"}</span>
                      <span className="text-xs text-muted-foreground">{s.name} · {duration(s.duration_min)}</span>
                    </span>
                    <span
                      className={
                        "rounded-full px-2 py-0.5 text-xs font-semibold " +
                        (i === 1 ? "bg-amber-50 text-amber-800" : "bg-blue-50 text-blue-800")
                      }
                    >
                      {i === 1 ? "Pendente" : "Confirmado"}
                    </span>
                  </li>
                ))}
              </ul>
              <div className="mt-3 flex items-center gap-2 rounded-xl bg-secondary p-3 text-sm">
                <Sparkles className="h-4 w-4 shrink-0 text-primary" />
                Vitrine no ar: <span className="font-mono text-xs">genixagenda.com.br/v/seu-espaco</span>
              </div>
            </div>
          </div>
        </section>

        {/* ---------- COMO FUNCIONA ---------- */}
        <section className="mx-auto max-w-6xl px-4 py-14 md:px-6">
          <h2 className="text-3xl md:text-[42px]">Como funciona</h2>
          <ol className="mt-8 grid gap-6 md:grid-cols-3">
            {STEPS.map((s, i) => (
              <li key={s.title} className="rounded-2xl border bg-card p-6">
                <span className="font-heading text-5xl text-primary/40">{i + 1}</span>
                <p className="mt-2 text-lg font-semibold">{s.title}</p>
                <p className="mt-1 text-muted-foreground">{s.text}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* ---------- SERVIÇOS PRONTOS ---------- */}
        {services.length > 0 && (
          <section className="border-y bg-secondary/50">
            <div className="mx-auto grid max-w-6xl gap-8 px-4 py-14 md:px-6 lg:grid-cols-[1fr_1.1fr] lg:items-center">
              <div>
                <h2 className="text-3xl md:text-[42px] md:leading-tight">Sua conta já nasce com estes serviços</h2>
                <p className="mt-3 text-muted-foreground">
                  Os serviços mais comuns de {niche.name.toLowerCase()} entram com um clique. É só ajustar os preços.
                </p>
              </div>
              <ul className="divide-y rounded-2xl border bg-white">
                {services.map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-4 p-4">
                    <span className="flex items-center gap-2">
                      <Check className="h-4 w-4 shrink-0 text-primary" />
                      <span className="font-medium">{t.name}</span>
                    </span>
                    <span className="shrink-0 text-sm text-muted-foreground">
                      {duration(t.duration_min)}{Number(t.price) > 0 && ` · ${brl(t.price)}`}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        )}

        {/* ---------- GESTÃO ---------- */}
        <section className="mx-auto max-w-6xl px-4 py-14 md:px-6">
          <h2 className="max-w-2xl text-3xl md:text-[42px] md:leading-tight">Gestão completa, sem complicação</h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map(({ icon: Icon, title, text }) => (
              <div key={title} className="rounded-2xl border bg-card p-5">
                <span className="grid h-10 w-10 place-items-center rounded-full bg-secondary text-primary">
                  <Icon className="h-5 w-5" />
                </span>
                <h3 className="mt-3 font-sans font-semibold">{title}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{text}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ---------- PLANOS ---------- */}
        <section className="border-t bg-secondary/40">
          <div className="mx-auto max-w-6xl px-4 py-14 md:px-6">
            <div className="text-center">
              <h2 className="text-3xl md:text-[42px]">Comece grátis. Cresça com o Completo.</h2>
              <p className="mx-auto mt-3 max-w-xl text-muted-foreground">
                Toda conta nova ganha 15 dias do Completo. Depois, assine ou continue no Grátis.
              </p>
            </div>
            <div className="mt-10">
              <Pricing plans={plans} />
            </div>
          </div>
        </section>
      </main>

      {/* Barra fixa no celular */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-white/95 p-3 backdrop-blur md:hidden">
        <Button asChild className="h-12 w-full text-base" data-testid="btn-nicho-teste-mobile">
          <Link href={signupHref}>Começar 15 dias grátis</Link>
        </Button>
      </div>

      <SiteFooter />
    </>
  );
}
