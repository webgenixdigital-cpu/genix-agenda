import type { Metadata } from "next";
import Link from "next/link";
import {
  BellRing, CalendarCheck, CalendarOff, Link2, MessageCircle, PlayCircle, Search, Star, Wallet,
} from "lucide-react";
import { createPublicClient } from "@/lib/supabase/public";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { NicheHighlights } from "@/components/niche-highlights";
import { Pricing, type Plan } from "@/components/marketing/pricing";
import { Button } from "@/components/ui/button";
import { getFeaturedNiches } from "@/lib/niches";

export const metadata: Metadata = {
  title: "Genix Agenda | Agenda online grátis e vitrine digital para profissionais",
  description:
    "Agenda online, vitrine digital e lembretes por WhatsApp para salões, barbearias, clínicas de estética e outros profissionais. Grátis para sempre para 1 profissional, sem cartão.",
  alternates: { canonical: "/" },
};

// Cache de 1 hora: só lê dados públicos (plans, niches) com o cliente sem cookies.
// Salvar um nicho no /genix já atualiza esta página (revalidatePath do layout).
export const revalidate = 3600;

// ---------------------------------------------------------------------
// PARTE 1 — Conteúdo
// ---------------------------------------------------------------------
// completo: recurso do plano Completo (aparece com etiqueta, para não prometer como grátis)
const BENEFITS = [
  { icon: Link2, title: "Sua vitrine com link próprio", text: "Serviços, preços, equipe e avaliações numa página bonita para colocar na bio do Instagram.", completo: false },
  { icon: CalendarCheck, title: "Agendamento 24 horas", text: "O cliente escolhe serviço e horário sozinho, até de madrugada. Você só confere o dia e atende.", completo: false },
  { icon: MessageCircle, title: "WhatsApp em um toque", text: "Confirmações, remarcações e agradecimentos já saem com a mensagem pronta. Nada de digitar tudo de novo.", completo: false },
  { icon: BellRing, title: "Lembretes de véspera", text: "Uma fila simples para lembrar todos os clientes de amanhã e reduzir as faltas.", completo: true },
  { icon: CalendarOff, title: "Férias e folgas sem dor de cabeça", text: "Bloqueie um dia, um período ou toda segunda-feira. Quem já estava marcado aparece para você avisar.", completo: true },
  { icon: Wallet, title: "Financeiro sob controle", text: "Faturamento do dia e do mês, ticket médio e caixa com Pix, cartão e dinheiro.", completo: true },
];

const STEPS = [
  { n: "1", title: "Crie sua conta", text: "Leva 2 minutos, sem cartão. O plano Grátis é seu para sempre." },
  { n: "2", title: "Siga o passo a passo", text: "O sistema guia você: serviços, horários, equipe e WhatsApp." },
  { n: "3", title: "Divulgue seu link", text: "Coloque na bio, no status e mande para os clientes. Pronto." },
];

const FAQ = [
  {
    q: "Preciso cadastrar cartão para testar?",
    a: "Não. Você usa tudo do Completo por 15 dias sem informar nenhum dado de pagamento. Só assina se quiser continuar com ele.",
  },
  {
    q: "O plano Grátis é para sempre mesmo?",
    a: "Sim. Vitrine com link próprio e agenda online para 1 profissional, com até 10 agendamentos online por dia, sem prazo para acabar e sem cartão. Lembretes, bloqueios, financeiro e acessos da equipe ficam no Completo.",
  },
  {
    q: "O que acontece se o teste acabar e eu não assinar?",
    a: "Sua conta passa automaticamente para o plano Grátis. Nada é apagado: a vitrine continua recebendo pedidos (até 10 por dia, com 1 profissional) e os recursos do Completo ficam disponíveis para assinar quando quiser.",
  },
  {
    q: "Como funciona o valor por profissional?",
    a: "O plano já inclui até 3 profissionais. A partir do 4º, cada pessoa ativa na equipe soma R$ 35,00 por mês (ou R$ 350,00 no plano anual).",
  },
  {
    q: "Quais formas de pagamento são aceitas?",
    a: "Pix e cartão de crédito com cobrança recorrente.",
  },
  {
    q: "Tem fidelidade?",
    a: "No plano mensal, não: cancele quando quiser. O plano anual é pago uma vez por ano, com 2 meses de desconto.",
  },
];

// ---------------------------------------------------------------------
// PARTE 2 — Página
// ---------------------------------------------------------------------
export default async function Home() {
  const supabase = createPublicClient();
  const [{ data }, niches] = await Promise.all([
    supabase
      .from("plans")
      .select("id, name, billing_cycle, base_price, included_professionals, extra_professional_price")
      .eq("active", true),
    getFeaturedNiches(),
  ]);

  const plans = (data ?? []).map((p) => ({
    ...p,
    base_price: Number(p.base_price),
    extra_professional_price: Number(p.extra_professional_price),
  })) as Plan[];

  return (
    <>
      <SiteHeader />

      <main>
        {/* ---------- HERO ---------- */}
        <section className="border-b bg-secondary/60">
          <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-14 md:px-6 md:py-20 lg:grid-cols-[1.1fr_1fr]">
            <div>
              <span className="inline-flex items-center gap-2 rounded-2xl bg-white px-3 py-1.5 text-sm font-semibold text-primary ring-1 ring-primary/20">
                Grátis para sempre: vitrine e agenda online para 1 profissional. Sem cartão.
              </span>
              <h1 className="mt-5 text-4xl leading-[1.06] md:text-[56px]">
                Seus clientes marcam sozinhos. Você só atende.
              </h1>
              <p className="mt-5 max-w-xl text-lg text-muted-foreground">
                Um link de agendamento para a sua bio, lembretes em um toque e o controle do dia num só lugar. Fácil de começar, fácil de usar.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Button asChild size="lg" className="h-12 px-7 text-base active:scale-95" data-testid="btn-hero-teste">
                  <Link href="/cadastro">Criar minha agenda grátis</Link>
                </Button>
                <Button asChild size="lg" variant="outline" className="h-12 bg-white px-6 text-base" data-testid="btn-hero-demo">
                  <Link href="/demo">
                    <PlayCircle className="mr-2 h-5 w-5" /> Ver demonstração
                  </Link>
                </Button>
              </div>
              <p className="mt-5 text-sm text-muted-foreground">
                Já é cliente?{" "}
                <Link href="/admin/login" className="font-semibold text-primary underline" data-testid="link-entrar">
                  Entrar no painel
                </Link>
              </p>
            </div>

            {/* Prévia do painel (só no desktop: no celular a busca fica logo abaixo dos botões) */}
            <div className="hidden rounded-3xl border bg-white p-5 shadow-xl shadow-stone-900/5 lg:block" aria-hidden>
              <div className="flex items-center justify-between">
                <p className="font-heading text-xl">Agenda de hoje</p>
                <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800 ring-1 ring-amber-600/30">
                  2 pedidos novos
                </span>
              </div>
              <ul className="mt-4 divide-y">
                {[
                  ["09:00", "Mariana R.", "Corte feminino", "Confirmado", "bg-blue-50 text-blue-800"],
                  ["10:30", "Fernanda S.", "Mechas", "Pendente", "bg-amber-50 text-amber-800"],
                  ["14:00", "Patrícia G.", "Hidratação", "Confirmado", "bg-blue-50 text-blue-800"],
                  ["16:30", "Beatriz L.", "Manicure", "Concluído", "bg-green-50 text-green-800"],
                ].map(([t, n, s, st, c]) => (
                  <li key={t} className="flex items-center gap-3 py-3">
                    <span className="w-12 font-semibold">{t}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{n}</span>
                      <span className="text-xs text-muted-foreground">{s}</span>
                    </span>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${c}`}>{st}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-secondary p-3">
                  <p className="text-xs text-muted-foreground">Faturamento hoje</p>
                  <p className="font-heading text-xl">R$ 640,00</p>
                </div>
                <div className="rounded-xl bg-secondary p-3">
                  <p className="text-xs text-muted-foreground">Nota na vitrine</p>
                  <p className="flex items-center gap-1 font-heading text-xl">
                    4,9 <Star className="h-4 w-4 fill-amber-500 text-amber-500" />
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* ---------- BUSCA (para quem quer agendar → /espacos) ---------- */}
          <div className="mx-auto max-w-6xl px-4 pb-14 md:px-6 md:pb-20">
            <form action="/espacos" method="get" role="search" className="mx-auto max-w-2xl">
              <label htmlFor="busca-home" className="block text-center font-heading text-2xl">
                Quer agendar um horário?
              </label>
              <div className="mt-4 flex items-center gap-2 rounded-full border bg-white p-1.5 pl-5 shadow-lg shadow-stone-900/5 focus-within:ring-2 focus-within:ring-ring">
                <Search className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
                <input
                  id="busca-home"
                  name="q"
                  type="search"
                  maxLength={60}
                  placeholder="Busque por nome do espaço, cidade ou serviço"
                  className="h-11 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
                  data-testid="input-busca-home"
                />
                <Button type="submit" className="h-11 shrink-0 rounded-full px-5" data-testid="btn-buscar-home">
                  Buscar
                </Button>
              </div>
            </form>

            {/* Nichos em destaque (administrados no /genix) → /para/[nicho] */}
            {niches.length > 0 && (
              <div className="mt-12">
                <h2 className="text-center text-2xl md:text-3xl">Feito para quem atende com hora marcada</h2>
                <NicheHighlights niches={niches} basePath="/para" singleRow className="mt-6" />
              </div>
            )}
          </div>
        </section>

        {/* ---------- BENEFÍCIOS ---------- */}
        <section className="mx-auto max-w-6xl px-4 py-16 md:px-6 md:py-20">
          <h2 className="max-w-2xl text-3xl md:text-[42px] md:leading-tight">
            Simples de usar, com o seu dia sob controle
          </h2>
          <p className="mt-3 max-w-2xl text-muted-foreground">
            Tudo o que um espaço que atende pessoas precisa, num lugar só. Comece no Grátis e libere o resto quando quiser.
          </p>
          <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {BENEFITS.map(({ icon: Icon, title, text, completo }) => (
              <div key={title} className="rounded-2xl border bg-card p-6">
                <div className="flex items-start justify-between gap-3">
                  <span className="grid h-11 w-11 place-items-center rounded-full bg-secondary text-primary">
                    <Icon className="h-5 w-5" />
                  </span>
                  {completo && (
                    <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">Completo</span>
                  )}
                </div>
                <h3 className="mt-4 font-sans text-lg font-semibold">{title}</h3>
                <p className="mt-1.5 text-muted-foreground">{text}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ---------- COMO FUNCIONA ---------- */}
        <section className="bg-foreground py-16 text-background md:py-20">
          <div className="mx-auto max-w-6xl px-4 md:px-6">
            <h2 className="text-3xl md:text-[42px]">Comece hoje, em 3 passos</h2>
            <ol className="mt-10 grid gap-8 md:grid-cols-3">
              {STEPS.map((s) => (
                <li key={s.n}>
                  <span className="font-heading text-5xl text-[#F2C078]">{s.n}</span>
                  <p className="mt-3 text-lg font-semibold">{s.title}</p>
                  <p className="mt-1 text-stone-300">{s.text}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* ---------- PLANOS ---------- */}
        <section id="planos" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-16 md:px-6 md:py-20">
          <div className="text-center">
            <h2 className="text-3xl md:text-[42px]">Comece grátis. Cresça com o Completo.</h2>
            <p className="mx-auto mt-3 max-w-xl text-muted-foreground">
              Toda conta nova ganha 15 dias do Completo. Depois, assine ou continue no Grátis, sem prazo para acabar.
            </p>
          </div>
          <div className="mt-10">
            <Pricing plans={plans} />
          </div>
        </section>

        {/* ---------- FAQ ---------- */}
        <section className="border-t bg-secondary/50">
          <div className="mx-auto max-w-3xl px-4 py-16 md:px-6 md:py-20">
            <h2 className="text-3xl md:text-[42px]">Perguntas frequentes</h2>
            <div className="mt-8 space-y-3">
              {FAQ.map((f) => (
                <details key={f.q} className="group rounded-2xl border bg-white p-5 open:shadow-sm">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold">
                    {f.q}
                    <span className="text-2xl leading-none text-primary transition-transform group-open:rotate-45">+</span>
                  </summary>
                  <p className="mt-3 text-muted-foreground">{f.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* ---------- CHAMADA FINAL ---------- */}
        <section className="mx-auto max-w-6xl px-4 py-16 text-center md:px-6 md:py-20">
          <h2 className="mx-auto max-w-2xl text-3xl md:text-[42px] md:leading-tight">
            Comece grátis hoje e veja sua agenda se organizar
          </h2>
          <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
            <Button asChild size="lg" className="h-12 px-8 text-base" data-testid="btn-final-teste">
              <Link href="/cadastro">Criar minha agenda grátis</Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="h-12 px-6 text-base" data-testid="btn-final-demo">
              <Link href="/demo">Ver demonstração</Link>
            </Button>
          </div>
        </section>
      </main>

      <SiteFooter />
    </>
  );
}
