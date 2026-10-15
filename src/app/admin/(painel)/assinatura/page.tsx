import { Check, Clock, CreditCard, Sparkles } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getAdminContext } from "@/lib/admin";
import { getPlanContext } from "@/lib/plan";
import { brl } from "@/lib/format";

export const dynamic = "force-dynamic";

type Quote = {
  plan: string;
  base_price: number;
  professionals: number;
  extra_professionals: number;
  extra_price: number;
  total: number;
};

const br = (iso: string) =>
  new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(iso));

const FULL = [
  "Agendamentos online ilimitados",
  "Equipe com vários profissionais",
  "Lembretes de véspera",
  "Bloqueios de férias e folgas",
  "Financeiro e caixa",
  "Vitrine sem o selo Genix",
];

// ---------------------------------------------------------------------
// PARTE 1 — Dados
// ---------------------------------------------------------------------
export default async function AssinaturaPage() {
  const { business } = await getAdminContext();
  const plan = await getPlanContext(business.id);
  const supabase = createClient();

  const [{ data: mensal }, { data: anual }] = await Promise.all([
    supabase.rpc("subscription_quote", { bid: business.id, p_plan: "mensal" }),
    supabase.rpc("subscription_quote", { bid: business.id, p_plan: "anual" }),
  ]);
  const qm = mensal as Quote | null;
  const qa = anual as Quote | null;

  // -------------------------------------------------------------------
  // PARTE 2 — Status atual
  // -------------------------------------------------------------------
  let statusTitle = "Plano Completo";
  let statusText = "Todos os recursos liberados.";
  let StatusIcon = Check;

  if (plan.internal) {
    statusTitle = "Conta interna";
    statusText = "Esta conta não tem cobrança.";
  } else if (plan.trialDaysLeft !== null) {
    statusTitle = "Teste do Completo";
    statusText = `Termina em ${br(plan.trialEndsAt!)} (${plan.trialDaysLeft === 1 ? "falta 1 dia" : `faltam ${plan.trialDaysLeft} dias`}). Depois, sua conta passa para o plano Grátis, sem perder nada.`;
    StatusIcon = Clock;
  } else if (plan.tier === "gratis") {
    statusTitle = "Plano Grátis";
    statusText = "Vitrine e pedidos de agendamento, com até 10 agendamentos online por dia e 1 profissional.";
    StatusIcon = Sparkles;
  } else if (plan.status === "active" && plan.currentPeriodEnd) {
    statusText = `Assinatura ativa. Próxima renovação em ${br(plan.currentPeriodEnd)}.`;
  }

  // -------------------------------------------------------------------
  // PARTE 3 — Página
  // -------------------------------------------------------------------
  return (
    <main className="mx-auto max-w-4xl space-y-6 p-4 md:p-8">
      <header>
        <h1 className="text-3xl md:text-4xl">Assinatura</h1>
        <p className="mt-1 text-sm text-muted-foreground">Seu plano atual e as opções do Genix Agenda Completo.</p>
      </header>

      <section className="flex gap-4 rounded-2xl border bg-card p-5" data-testid="status-assinatura">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-secondary text-primary">
          <StatusIcon className="h-6 w-6" />
        </span>
        <div>
          <p className="font-heading text-2xl">{statusTitle}</p>
          <p className="mt-1 text-muted-foreground">{statusText}</p>
        </div>
      </section>

      {qm && qa && plan.status !== "active" && !plan.internal && (
        <section className="space-y-4">
          <h2 className="text-2xl">Plano Completo para o seu espaço</h2>
          <p className="text-sm text-muted-foreground">
            Calculado para {qm.professionals} {qm.professionals === 1 ? "profissional ativo" : "profissionais ativos"}.
            {qm.extra_professionals > 0 &&
              ` Inclui ${qm.extra_professionals} ${qm.extra_professionals === 1 ? "profissional extra" : "profissionais extras"}.`}
          </p>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-2xl border bg-card p-5" data-testid="opcao-mensal">
              <p className="text-sm font-semibold text-muted-foreground">Mensal</p>
              <p className="mt-2 font-heading text-4xl">{brl(qm.total)}<span className="text-base text-muted-foreground"> /mês</span></p>
              <p className="mt-1 text-sm text-muted-foreground">Sem fidelidade.</p>
            </div>
            <div className="relative rounded-2xl border-2 border-primary bg-card p-5" data-testid="opcao-anual">
              <span className="absolute -top-3 left-5 rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground">
                2 meses grátis
              </span>
              <p className="text-sm font-semibold text-primary">Anual</p>
              <p className="mt-2 font-heading text-4xl">{brl(qa.total)}<span className="text-base text-muted-foreground"> /ano</span></p>
              <p className="mt-1 text-sm text-green-700">
                Equivale a {brl(qa.total / 12)} por mês. Economia de {brl(qm.total * 12 - qa.total)} no ano.
              </p>
            </div>
          </div>

          <ul className="grid gap-2 rounded-2xl bg-secondary p-5 sm:grid-cols-2">
            {FULL.map((f) => (
              <li key={f} className="flex gap-2 text-sm">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" /> {f}
              </li>
            ))}
          </ul>

          <div className="flex gap-3 rounded-2xl border border-dashed bg-white p-5" data-testid="aviso-pagamento">
            <CreditCard className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
            <p className="text-sm text-muted-foreground">
              <strong className="text-foreground">O pagamento online (Pix, boleto e cartão) será liberado em breve nesta tela.</strong>{" "}
              Até lá, seu teste continua valendo normalmente.
            </p>
          </div>
        </section>
      )}
    </main>
  );
}
