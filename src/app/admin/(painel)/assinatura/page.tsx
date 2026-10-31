import { Check, Clock, ExternalLink, Sparkles, XCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireRoles } from "@/lib/admin";
import { getFreeDailyLimit, getPlanContext, PLAN_NAMES, recommendedKind } from "@/lib/plan";
import { cycleOfPlanId, isLegacyPlanId, kindOfPlanId, planIdFor, type PaidPlanId } from "@/lib/plan-ids";
import { brl } from "@/lib/format";
import { availablePaidPlans, plansPreview } from "@/lib/plans-server";
import { Button } from "@/components/ui/button";
import { SubscribeForm, type Quotes } from "@/components/admin/assinatura/subscribe-form";
import { CancelSubscriptionButton } from "@/components/admin/assinatura/cancel-button";
import { CancelPlanChangeButton, ChangePlanButton } from "@/components/admin/assinatura/change-plan";
import { BillingSummary, type BillingChange } from "@/components/admin/assinatura/billing-summary";

export const dynamic = "force-dynamic";

type Quote = { total: number; professionals: number; extra_professionals: number };

const br = (iso: string) =>
  new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric" }).format(
    new Date(iso.length === 10 ? `${iso}T12:00:00` : iso)
  );

const METHOD_LABEL: Record<string, string> = { PIX: "Pix", BOLETO: "Boleto", CREDIT_CARD: "Cartão de crédito" };

const INCLUDES = {
  profissional: [
    "Agendamentos online ilimitados",
    "Bloqueios, recorrência, pacotes e retornos",
    "Financeiro, faturamento e relatório do contador",
    "Vitrine sem o selo Genix",
  ],
  equipe: [
    "Tudo do Profissional",
    "Até 3 profissionais (extra por profissional)",
    "Acessos da equipe: recepção e profissionais",
    "Comissões, “Meus ganhos” e salão-parceiro",
  ],
};

// ---------------------------------------------------------------------
// PARTE 1 — Dados
// ---------------------------------------------------------------------
export default async function AssinaturaPage() {
  const { business, role } = await requireRoles(["owner", "viewer"]);
  const plan = await getPlanContext(business.id);
  const supabase = createClient();

  const ids: PaidPlanId[] = ["profissional_mensal", "profissional_anual", "equipe_mensal", "equipe_anual"];
  const [quoteRows, { data: sub }, freeLimit, available, { data: changes }] = await Promise.all([
    Promise.all(ids.map((id) => supabase.rpc("subscription_quote", { bid: business.id, p_plan: id }))),
    supabase
      .from("subscriptions")
      .select(
        "plan_id, amount, billing_type, asaas_subscription_id, pending_invoice_url, pending_due_date, current_period_end, scheduled_plan_id, upgrade_plan_id, upgrade_invoice_url, billing_sync_status"
      )
      .eq("business_id", business.id)
      .maybeSingle(),
    getFreeDailyLimit(),
    availablePaidPlans(),
    // histórico da cobrança do profissional extra (29; a RLS mostra só para a matriz)
    supabase
      .from("subscription_billing_changes")
      .select("id, kind, reason, professionals, extra_professionals, old_amount, new_amount, payment_value, payment_due_date, payment_status, invoice_url, created_at")
      .eq("business_id", business.id)
      .order("created_at", { ascending: false })
      .limit(12),
  ]);
  // valor esperado da próxima cobrança (plano da renovação + extras de agora)
  const renewalPlan = sub?.scheduled_plan_id ?? sub?.plan_id ?? null;
  const { data: renewalQuote } = renewalPlan
    ? await supabase.rpc("subscription_quote", { bid: business.id, p_plan: renewalPlan })
    : { data: null };
  const rq = renewalQuote as (Quote & { included: number }) | null;
  const q = Object.fromEntries(ids.map((id, i) => [id, quoteRows[i].data as Quote | null])) as Record<PaidPlanId, Quote | null>;
  // planos novos só aparecem ativos depois da 28b (ou no modo de prévia local)
  const quotesOk = ids.every((id) => q[id] && available.has(id));
  const preview = plansPreview();
  const quotes: Quotes | null = quotesOk
    ? {
        profissional: { mensal: Number(q.profissional_mensal!.total), anual: Number(q.profissional_anual!.total) },
        equipe: { mensal: Number(q.equipe_mensal!.total), anual: Number(q.equipe_anual!.total) },
      }
    : null;
  const activePros = q.equipe_mensal?.professionals ?? 1;
  const recommended = recommendedKind(activePros);

  const hasPending = !!sub?.asaas_subscription_id && plan.status !== "active" && plan.status !== "past_due";
  const isActive = plan.status === "active" || plan.status === "past_due";
  const isCanceledWithAccess = plan.status === "canceled" && plan.tier === "completo";

  const trialEnd = plan.trialEndsAt && plan.trialDaysLeft !== null ? br(plan.trialEndsAt) : null;
  const firstDueLabel = trialEnd ? `em ${trialEnd} (fim do teste)` : "hoje";

  const currentKind = kindOfPlanId(sub?.plan_id);
  const currentCycle = cycleOfPlanId(sub?.plan_id);
  const legacy = isLegacyPlanId(sub?.plan_id);

  // -------------------------------------------------------------------
  // PARTE 2 — Status atual
  // -------------------------------------------------------------------
  let statusTitle = `Plano ${PLAN_NAMES[plan.kind]}`;
  let statusText = "Todos os recursos do seu plano liberados.";
  let StatusIcon = Check;

  if (plan.internal) {
    statusTitle = "Conta interna";
    statusText = "Esta conta não tem cobrança.";
  } else if (isActive) {
    statusTitle = `${PLAN_NAMES[currentKind]} ${currentCycle} ativo`;
    statusText = plan.currentPeriodEnd
      ? `Próxima renovação em ${br(plan.currentPeriodEnd)}${sub?.amount ? `, no valor de ${brl(sub.amount)}` : ""}.`
      : "Assinatura ativa.";
    if (legacy) statusText += " Você mantém o valor contratado no antigo plano Completo.";
    if (plan.status === "past_due") {
      statusTitle = "Pagamento em atraso";
      statusText = "Regularize a fatura para não perder os recursos do seu plano.";
      StatusIcon = XCircle;
    }
  } else if (isCanceledWithAccess) {
    statusTitle = "Assinatura cancelada";
    statusText = `Você continua no ${PLAN_NAMES[currentKind]} até ${br(plan.currentPeriodEnd!)}. Depois, a conta passa para o plano Grátis.`;
    StatusIcon = XCircle;
  } else if (plan.trialDaysLeft !== null) {
    statusTitle = "Teste grátis do plano Equipe";
    statusText = `Termina em ${trialEnd} (${plan.trialDaysLeft === 1 ? "falta 1 dia" : `faltam ${plan.trialDaysLeft} dias`}). Para continuar com tudo, assine o ${PLAN_NAMES[recommended]}. Sem assinatura, sua conta passa para o Grátis, sem perder nada.`;
    StatusIcon = Clock;
  } else if (plan.tier === "gratis") {
    statusTitle = "Plano Grátis";
    statusText = `Vitrine, agenda online com até ${freeLimit} agendamentos online por dia, 1 profissional e lembretes de véspera. Para sempre.`;
    StatusIcon = Sparkles;
  }

  // troca entre Profissional e Equipe (mesmo ciclo)
  const otherKind = currentKind === "equipe" ? "profissional" : "equipe";
  const otherId = planIdFor(otherKind, currentCycle);
  const otherPrice = quotes ? quotes[otherKind][currentCycle] : null;

  // -------------------------------------------------------------------
  // PARTE 3 — Página
  // -------------------------------------------------------------------
  return (
    <main className="mx-auto max-w-3xl space-y-8 p-4 md:p-8">
      <header className="text-center">
        <h1 className="text-3xl md:text-4xl">Assinatura</h1>
        <p className="mt-1 text-sm text-muted-foreground">Seu plano atual e os planos Profissional e Equipe.</p>
      </header>

      {preview && (
        <p className="rounded-2xl border border-dashed border-amber-400 bg-amber-50 p-3 text-sm text-amber-900" data-testid="aviso-previa-planos">
          <strong>Modo de prévia local (PLANS_PREVIEW=1):</strong> planos novos liberados mesmo inativos no banco. Use só com o
          Asaas sandbox. Nunca liga em produção.
        </p>
      )}

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
          Só o dono do espaço pode assinar, trocar de plano ou cancelar.
        </p>
      )}

      {/* Pagamento pendente */}
      {hasPending && (
        <section className="space-y-4 rounded-2xl border-2 border-amber-300 bg-amber-50 p-5" data-testid="pagamento-pendente">
          <div>
            <p className="font-heading text-2xl text-amber-950">Pagamento pendente</p>
            <p className="mt-1 text-sm text-amber-900">
              {PLAN_NAMES[currentKind]} {currentCycle} de {sub?.amount ? brl(sub.amount) : "—"}, por{" "}
              {METHOD_LABEL[sub?.billing_type ?? ""] ?? "—"}
              {sub?.pending_due_date ? `, com vencimento em ${br(sub.pending_due_date)}` : ""}. Assim que o pagamento for
              confirmado, seu plano é ativado automaticamente.
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

      {/* Equipe: profissionais que entram no valor, avulsas de extra e histórico */}
      {(isActive || hasPending) && role === "owner" && currentKind === "equipe" && !sub?.scheduled_plan_id && rq && (
        <BillingSummary
          professionals={Number(rq.professionals)}
          included={Number(rq.included)}
          extras={Number(rq.extra_professionals)}
          amount={sub?.amount != null ? Number(sub.amount) : null}
          expected={Number(rq.total)}
          syncPending={sub?.billing_sync_status === "pendente"}
          changes={((changes ?? []) as BillingChange[]).map((c) => ({
            ...c,
            old_amount: c.old_amount != null ? Number(c.old_amount) : null,
            new_amount: c.new_amount != null ? Number(c.new_amount) : null,
            payment_value: c.payment_value != null ? Number(c.payment_value) : null,
          }))}
        />
      )}

      {/* Assinatura ativa: forma de pagamento, troca de plano e cancelamento */}
      {isActive && role === "owner" && (
        <section className="space-y-4 rounded-2xl border bg-card p-5" data-testid="assinatura-ativa">
          <p className="text-sm text-muted-foreground">
            Forma de pagamento: <strong className="text-foreground">{METHOD_LABEL[sub?.billing_type ?? ""] ?? "—"}</strong>
          </p>

          {/* Troca aguardando pagamento (upgrade anual) */}
          {sub?.upgrade_plan_id && (
            <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900" data-testid="troca-aguardando">
              <p>
                Mudança para o <strong>Equipe</strong> aguardando o pagamento da diferença proporcional. Assim que for paga,
                o Equipe é liberado.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {sub.upgrade_invoice_url && (
                  <Button asChild className="h-11" data-testid="btn-fatura-troca">
                    <a href={sub.upgrade_invoice_url} target="_blank" rel="noopener noreferrer">
                      Pagar a diferença <ExternalLink className="ml-1.5 h-4 w-4" />
                    </a>
                  </Button>
                )}
                <CancelPlanChangeButton label="Desistir da mudança" />
              </div>
            </div>
          )}

          {/* Troca agendada (downgrade) */}
          {sub?.scheduled_plan_id && (
            <div className="rounded-xl bg-secondary p-4 text-sm" data-testid="troca-agendada">
              <p>
                Troca agendada: na próxima renovação{plan.currentPeriodEnd ? ` (${br(plan.currentPeriodEnd)})` : ""} você passa
                para o <strong>{PLAN_NAMES[kindOfPlanId(sub.scheduled_plan_id)]}</strong>. Os acessos da equipe ficam pausados,
                sem apagar nada, e voltam se você retornar ao Equipe.
              </p>
              <div className="mt-2">
                <CancelPlanChangeButton label="Manter o Equipe" />
              </div>
            </div>
          )}

          {plan.status === "active" && !sub?.upgrade_plan_id && !sub?.scheduled_plan_id && otherPrice !== null && available.has(otherId) && (
            <ChangePlanButton
              target={otherId}
              direction={otherKind === "equipe" ? "up" : "down"}
              price={otherPrice}
              cycle={currentCycle}
              blockedReason={
                otherKind === "profissional" && activePros > 1
                  ? `Você tem ${activePros} profissionais ativos. Para o Profissional, deixe só 1 ativo.`
                  : undefined
              }
            />
          )}

          <div className="border-t pt-3">
            <CancelSubscriptionButton
              label="Cancelar assinatura"
              confirmText="Cancelar a renovação? Você continua no plano atual até o fim do período já pago."
            />
          </div>
        </section>
      )}

      {/* Assinar */}
      {!plan.internal && !isActive && !hasPending && !isCanceledWithAccess && role === "owner" && (
        <section className="space-y-5 rounded-2xl border bg-card p-5 md:p-6">
          <div>
            <h2 className="text-2xl">Escolha seu plano</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Você tem {activePros} {activePros === 1 ? "profissional ativo" : "profissionais ativos"}. Anual = 2 meses grátis.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {(["profissional", "equipe"] as const).map((k) => (
              <ul key={k} className="space-y-2 rounded-xl bg-secondary p-4">
                <li className="text-sm font-semibold">{PLAN_NAMES[k]}</li>
                {INCLUDES[k].map((f) => (
                  <li key={f} className="flex gap-2 text-sm">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" /> {f}
                  </li>
                ))}
              </ul>
            ))}
          </div>

          {quotes ? (
            <SubscribeForm
              quotes={quotes}
              activePros={activePros}
              equipeExtras={q.equipe_mensal?.extra_professionals ?? 0}
              recommended={recommended}
              firstDueLabel={firstDueLabel}
            />
          ) : (
            <p className="text-sm text-muted-foreground">Os planos ainda não estão disponíveis para assinatura. Tente de novo em instantes.</p>
          )}
        </section>
      )}
    </main>
  );
}
