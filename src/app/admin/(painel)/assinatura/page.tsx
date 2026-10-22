import { Check, Clock, ExternalLink, Sparkles, XCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireRoles } from "@/lib/admin";
import { getPlanContext } from "@/lib/plan";
import { brl } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { SubscribeForm } from "@/components/admin/assinatura/subscribe-form";
import { CancelSubscriptionButton } from "@/components/admin/assinatura/cancel-button";

export const dynamic = "force-dynamic";

type Quote = { total: number; professionals: number; extra_professionals: number };

const br = (iso: string) =>
  new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric" }).format(
    new Date(iso.length === 10 ? `${iso}T12:00:00` : iso)
  );

const METHOD_LABEL: Record<string, string> = { PIX: "Pix", BOLETO: "Boleto", CREDIT_CARD: "Cartão de crédito" };

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
  const { business, role } = await requireRoles(["owner", "viewer"]);
  const plan = await getPlanContext(business.id);
  const supabase = createClient();

  const [{ data: mensal }, { data: anual }, { data: sub }] = await Promise.all([
    supabase.rpc("subscription_quote", { bid: business.id, p_plan: "mensal" }),
    supabase.rpc("subscription_quote", { bid: business.id, p_plan: "anual" }),
    supabase
      .from("subscriptions")
      .select("plan_id, amount, billing_type, asaas_subscription_id, pending_invoice_url, pending_due_date, current_period_end")
      .eq("business_id", business.id)
      .maybeSingle(),
  ]);
  const qm = mensal as Quote | null;
  const qa = anual as Quote | null;

  const hasPending = !!sub?.asaas_subscription_id && plan.status !== "active" && plan.status !== "past_due";
  const isActive = plan.status === "active" || plan.status === "past_due";
  const isCanceledWithAccess = plan.status === "canceled" && plan.tier === "completo";

  const trialEnd = plan.trialEndsAt && plan.trialDaysLeft !== null ? br(plan.trialEndsAt) : null;
  const firstDueLabel = trialEnd ? `em ${trialEnd} (fim do teste)` : "hoje";

  // -------------------------------------------------------------------
  // PARTE 2 — Status atual
  // -------------------------------------------------------------------
  let statusTitle = "Plano Completo";
  let statusText = "Todos os recursos liberados.";
  let StatusIcon = Check;

  if (plan.internal) {
    statusTitle = "Conta interna";
    statusText = "Esta conta não tem cobrança.";
  } else if (isActive) {
    statusTitle = `Completo ${sub?.plan_id === "anual" ? "anual" : "mensal"} ativo`;
    statusText = plan.currentPeriodEnd
      ? `Próxima renovação em ${br(plan.currentPeriodEnd)}${sub?.amount ? `, no valor de ${brl(sub.amount)}` : ""}.`
      : "Assinatura ativa.";
    if (plan.status === "past_due") {
      statusTitle = "Pagamento em atraso";
      statusText = "Regularize a fatura para não perder os recursos do Completo.";
      StatusIcon = XCircle;
    }
  } else if (isCanceledWithAccess) {
    statusTitle = "Assinatura cancelada";
    statusText = `Você continua no Completo até ${br(plan.currentPeriodEnd!)}. Depois, a conta passa para o plano Grátis.`;
    StatusIcon = XCircle;
  } else if (plan.trialDaysLeft !== null) {
    statusTitle = "Teste do Completo";
    statusText = `Termina em ${trialEnd} (${plan.trialDaysLeft === 1 ? "falta 1 dia" : `faltam ${plan.trialDaysLeft} dias`}). Depois, sua conta passa para o plano Grátis, sem perder nada.`;
    StatusIcon = Clock;
  } else if (plan.tier === "gratis") {
    statusTitle = "Plano Grátis";
    statusText = "Vitrine e pedidos de agendamento, com até 10 agendamentos online por dia e 1 profissional.";
    StatusIcon = Sparkles;
  }

  // -------------------------------------------------------------------
  // PARTE 3 — Página
  // -------------------------------------------------------------------
  return (
    <main className="mx-auto max-w-3xl space-y-6 p-4 md:p-8">
      <header>
        <h1 className="text-3xl md:text-4xl">Assinatura</h1>
        <p className="mt-1 text-sm text-muted-foreground">Seu plano atual e o Genix Agenda Completo.</p>
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

      {role !== "owner" && !plan.internal && (
        <p className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          Só o dono do espaço pode assinar ou cancelar.
        </p>
      )}

      {/* Pagamento pendente */}
      {hasPending && (
        <section className="space-y-4 rounded-2xl border-2 border-amber-300 bg-amber-50 p-5" data-testid="pagamento-pendente">
          <div>
            <p className="font-heading text-2xl text-amber-950">Pagamento pendente</p>
            <p className="mt-1 text-sm text-amber-900">
              Plano {sub?.plan_id === "anual" ? "anual" : "mensal"} de {sub?.amount ? brl(sub.amount) : "—"}, por{" "}
              {METHOD_LABEL[sub?.billing_type ?? ""] ?? "—"}
              {sub?.pending_due_date ? `, com vencimento em ${br(sub.pending_due_date)}` : ""}. Assim que o pagamento for
              confirmado, seu plano Completo é ativado automaticamente.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {sub?.pending_invoice_url && (
              <Button asChild className="h-11" data-testid="btn-abrir-fatura">
                <a href={sub.pending_invoice_url} target="_blank" rel="noopener noreferrer">
                  Abrir fatura <ExternalLink className="ml-1.5 h-4 w-4" />
                </a>
              </Button>
            )}
            {role === "owner" && (
              <CancelSubscriptionButton
                label="Cancelar e trocar de plano"
                confirmText="Cancelar esta cobrança pendente? Você poderá escolher outro plano em seguida."
              />
            )}
          </div>
        </section>
      )}

      {/* Assinatura ativa */}
      {isActive && role === "owner" && (
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-card p-5">
          <p className="text-sm text-muted-foreground">
            Forma de pagamento: <strong className="text-foreground">{METHOD_LABEL[sub?.billing_type ?? ""] ?? "—"}</strong>
          </p>
          <CancelSubscriptionButton
            label="Cancelar assinatura"
            confirmText="Cancelar a renovação? Você continua com o Completo até o fim do período já pago."
          />
        </section>
      )}

      {/* Assinar */}
      {!plan.internal && !isActive && !hasPending && !isCanceledWithAccess && role === "owner" && qm && qa && (
        <section className="space-y-5 rounded-2xl border bg-card p-5 md:p-6">
          <div>
            <h2 className="text-2xl">Assinar o Completo</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Calculado para {qm.professionals} {qm.professionals === 1 ? "profissional ativo" : "profissionais ativos"}
              {qm.extra_professionals > 0 &&
                `, com ${qm.extra_professionals} ${qm.extra_professionals === 1 ? "profissional extra" : "profissionais extras"}`}
              .
            </p>
          </div>

          <ul className="grid gap-2 rounded-xl bg-secondary p-4 sm:grid-cols-2">
            {FULL.map((f) => (
              <li key={f} className="flex gap-2 text-sm">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" /> {f}
              </li>
            ))}
          </ul>

          <SubscribeForm monthly={Number(qm.total)} yearly={Number(qa.total)} firstDueLabel={firstDueLabel} />
        </section>
      )}
    </main>
  );
}
