import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BellRing, CalendarCheck, CalendarOff, Check, Link2, PlayCircle, Users, Wallet } from "lucide-react";
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
  const niches = await getActiveNiches();
  return niches.find((n) => n.id === id) ?? null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const n = await findNiche(params.nicho);
  if (!n) return { title: "Página não encontrada" };
  return {
    title: `Agenda online para ${n.name} | Genix Agenda`,
    description: `Vitrine digital, agendamento online e lembretes por WhatsApp para ${n.name.toLowerCase()}. ${n.description ?? ""} Teste grátis por 15 dias.`,
  };
}

const BENEFITS = [
  { icon: Link2, title: "Vitrine com link próprio", text: "Serviços, preços e equipe numa página para a bio do Instagram." },
  { icon: CalendarCheck, title: "Agendamento 24 horas", text: "O cliente marca sozinho, só nos horários livres de verdade." },
  { icon: BellRing, title: "Lembretes pelo WhatsApp", text: "Confirmações e lembretes de véspera em um toque." },
  { icon: CalendarOff, title: "Folgas e férias", text: "Bloqueie períodos e veja quem precisa ser avisado." },
  { icon: Users, title: "Acesso para a equipe", text: "Cada profissional com o próprio login e a própria agenda." },
  { icon: Wallet, title: "Financeiro e comissões", text: "Caixa do dia, faturamento do mês e ganhos de cada profissional." },
];

// ---------------------------------------------------------------------
// Página do nicho
// ---------------------------------------------------------------------
export default async function NichoPage({ params }: Props) {
  const niche = await findNiche(params.nicho);
  if (!niche) notFound();

  const supabase = createClient();
  const [{ data: templates }, { data: plansData }, { count }] = await Promise.all([
    supabase
      .from("niche_service_templates")
      .select("id, name, category, duration_min, price")
      .eq("niche_id", niche.id)
      .order("sort_order"),
    supabase
      .from("plans")
      .select("id, name, billing_cycle, base_price, included_professionals, extra_professional_price")
      .eq("active", true),
    supabase.from("public_directory").select("id", { count: "exact", head: true }).eq("subcategory", niche.id),
  ]);

  const plans = (plansData ?? []).map((p) => ({
    ...p,
    base_price: Number(p.base_price),
    extra_professional_price: Number(p.extra_professional_price),
  })) as Plan[];

  const signupHref = `/cadastro?nicho=${niche.id}`;

  return (
    <>
      <SiteHeader />

      <main>
        {/* ---------- HERO ---------- */}
        <section className="border-b bg-secondary/60">
          <div className="mx-auto max-w-6xl px-4 py-14 md:px-6 md:py-20">
            <span className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1.5 text-sm font-semibold text-primary ring-1 ring-primary/20">
              <NicheIcon name={niche.icon} className="h-4 w-4" /> {niche.name}
            </span>
            <h1 className="mt-5 max-w-3xl text-4xl leading-[1.06] md:text-[56px]">
              Agenda online para {niche.name.toLowerCase()}
            </h1>
            <p className="mt-5 max-w-xl text-lg text-muted-foreground">
              {niche.description} Seus clientes agendam pela vitrine e você confirma com um toque no WhatsApp.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Button asChild size="lg" className="h-12 px-7 text-base" data-testid="btn-nicho-teste">
                <Link href={signupHref}>Começar 15 dias grátis</Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="h-12 bg-white px-6 text-base">
                <Link href="/demo"><PlayCircle className="mr-2 h-5 w-5" /> Ver demonstração</Link>
              </Button>
            </div>
            {(count ?? 0) > 0 && (
              <p className="mt-5 text-sm text-muted-foreground">
                <Link href={`/?nicho=${niche.id}#resultados`} className="underline">
                  {count} {count === 1 ? "espaço" : "espaços"} de {niche.name.toLowerCase()}
                </Link>{" "}
                já recebem agendamentos pelo Genix.
              </p>
            )}
          </div>
        </section>

        {/* ---------- SERVIÇOS PRONTOS ---------- */}
        {(templates ?? []).length > 0 && (
          <section className="mx-auto max-w-6xl px-4 py-14 md:px-6">
            <div className="grid gap-8 lg:grid-cols-[1fr_1.1fr] lg:items-center">
              <div>
                <h2 className="text-3xl md:text-[42px] md:leading-tight">Você já começa com estes serviços</h2>
                <p className="mt-3 text-muted-foreground">
                  Na criação da conta, os serviços mais comuns de {niche.name.toLowerCase()} entram com um clique.
                  É só ajustar os preços e a vitrine fica pronta.
                </p>
              </div>
              <ul className="divide-y rounded-2xl border bg-card">
                {templates!.map((t) => (
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

        {/* ---------- BENEFÍCIOS ---------- */}
        <section className="border-y bg-secondary/50">
          <div className="mx-auto max-w-6xl px-4 py-14 md:px-6">
            <h2 className="text-3xl md:text-[42px]">Tudo no mesmo lugar</h2>
            <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {BENEFITS.map(({ icon: Icon, title, text }) => (
                <div key={title} className="rounded-2xl bg-white p-6">
                  <span className="grid h-11 w-11 place-items-center rounded-full bg-secondary text-primary">
                    <Icon className="h-5 w-5" />
                  </span>
                  <h3 className="mt-4 font-sans text-lg font-semibold">{title}</h3>
                  <p className="mt-1 text-muted-foreground">{text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ---------- PLANOS ---------- */}
        <section className="mx-auto max-w-6xl px-4 py-14 md:px-6">
          <div className="text-center">
            <h2 className="text-3xl md:text-[42px]">Comece grátis. Cresça com o Completo.</h2>
            <p className="mx-auto mt-3 max-w-xl text-muted-foreground">
              Toda conta nova ganha 15 dias do Completo. Depois, assine ou continue no Grátis.
            </p>
          </div>
          <div className="mt-10">
            <Pricing plans={plans} />
          </div>
        </section>
      </main>

      <SiteFooter />
    </>
  );
}
