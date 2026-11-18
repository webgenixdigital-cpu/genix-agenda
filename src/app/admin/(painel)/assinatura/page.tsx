import { Ajuda } from "@/components/ajuda";
import { Check, Clock, ExternalLink, Sparkles, XCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireRoles } from "@/lib/admin";
import { getFreeDailyLimit, getPlanContext, PLAN_NAMES, recommendedKind } from "@/lib/plan";
import {
  cycleOfPlanId, isLegacyPlanId, isSoloKind, kindOfPlanId, PAID_KINDS, PAID_PLAN_IDS, paidRank, planIdFor, type PaidKind, type PaidPlanId,
} from "@/lib/plan-ids";
import { brl } from "@/lib/format";
import { availablePaidPlans, getLaunchOffer, getPublicPlans, plansPreview } from "@/lib/plans-server";
import { offerEndLabel, offerOpen } from "@/lib/plans-public";
import { LAUNCH_TEXT } from "@/content/planos";
import { PlansComparison } from "@/components/plans-comparison";
import { Button } from "@/components/ui/button";
import { SubscribeForm, type Discounts, type Quotes } from "@/components/admin/assinatura/subscribe-form";
import { CancelSubscriptionButton } from "@/components/admin/assinatura/cancel-button";
import { CancelPlanChangeButton, ChangePlanButton } from "@/components/admin/assinatura/change-plan";
import { BillingSummary, type BillingChange } from "@/components/admin/assinatura/billing-summary";

export const dynamic = "force-dynamic";

type Quote = {
  total: number;
  professionals: number;
  extra_professionals: number;
  // cupom de lançamento (53)
  full_total: number;
  discounted: boolean;
  coupon_label: string | null;
  discount_months: number | null;
  /** 1º vencimento sem desconto (null = ainda não assinou) */
  discount_ends_on: string | null;
};

const br = (iso: string) =>
  new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric" }).format(
    new Date(iso.length === 10 ? `${iso}T12:00:00` : iso)
  );

const METHOD_LABEL: Record<string, string> = { PIX: "Pix", BOLETO: "Boleto", CREDIT_CARD: "Cartão de crédito" };

const daysLabel = (n: number) => (n === 1 ? "falta 1 dia" : `faltam ${n} dias`);

/** "Desconto até": o dia anterior ao 1º vencimento sem desconto */
const dayBefore = (ymd: string) => {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};

// ---------------------------------------------------------------------
// PARTE 1 — Dados
// ---------------------------------------------------------------------
export default async function AssinaturaPage() {
  const { business, role } = await requireRoles(["owner", "viewer"]);
  const plan = await getPlanContext(business.id);
  const supabase = createClient();

  const ids: PaidPlanId[] = [...PAID_PLAN_IDS];
  const [quoteRows, { data: sub }, freeLimit, available, { data: changes }, publicPlans, launchOffer] = await Promise.all([
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
    // preços da tabela comparativa (planos ativos; todos no modo de prévia)
    getPublicPlans(),
    // cupom de lançamento no prazo (53)
    getLaunchOffer(),
  ]);
  // valor esperado da próxima cobrança (plano da renovação + extras de agora)
  const renewalPlan = sub?.scheduled_plan_id ?? sub?.plan_id ?? null;
  const { data: renewalQuote } = renewalPlan
    ? await supabase.rpc("subscription_quote", { bid: business.id, p_plan: renewalPlan })
    : { data: null };
  const rq = renewalQuote as (Quote & { included: number }) | null;
  const offer = offerOpen(launchOffer) ? launchOffer : null;
  const q = Object.fromEntries(ids.map((id, i) => [id, quoteRows[i].data as Quote | null])) as Record<PaidPlanId, Quote | null>;
  // o Básico só aparece ativo depois da 52b (ou no modo de prévia local)
  const quotesOk = ids.every((id) => q[id] && available.has(id));
  const preview = plansPreview();
  const quotes: Quotes | null = quotesOk
    ? (Object.fromEntries(
        PAID_KINDS.map((k) => [k, { mensal: Number(q[planIdFor(k, "mensal")]!.total), anual: Number(q[planIdFor(k, "anual")]!.total) }])
      ) as Quotes)
    : null;
  // cupom de lançamento (53): preço cheio e o aviso de cada plano com desconto
  const discountNote = (x: Quote) =>
    x.discount_ends_on
      ? LAUNCH_TEXT.subscribed(br(dayBefore(x.discount_ends_on)), brl(Number(x.full_total)))
      : offer
        ? `${LAUNCH_TEXT.until(x.coupon_label ?? offer.label, offerEndLabel(offer))} · ${LAUNCH_TEXT.forMonths(x.discount_months ?? offer.duration_months)}`
        : LAUNCH_TEXT.forMonths(x.discount_months ?? 12);
  const discountOf = (x: Quote | null) =>
    x && x.discounted && Number(x.full_total) > Number(x.total) ? { full: Number(x.full_total), note: discountNote(x) } : null;
  const discounts: Discounts | null = quotesOk
    ? (Object.fromEntries(
        PAID_KINDS.map((k) => [k, { mensal: discountOf(q[planIdFor(k, "mensal")]), anual: discountOf(q[planIdFor(k, "anual")]) }])
      ) as Discounts)
    : null;
  // a tabela comparativa só mostra o preço de lançamento para quem ainda pode usar
  const tableOffer = q.profissional_mensal?.discounted ? offer : null;

  const activePros = q.equipe_mensal?.professionals ?? 1;
  // fim do teste: 1 profissional → Profissional; Grátis: 1 profissional → Básico; 2+ → Equipe
  const recommended: PaidKind = plan.trialDaysLeft !== null ? recommendedKind(activePros) : activePros <= 1 ? "basico" : "equipe";
  const freeEnd = plan.freeEndsAt ? br(plan.freeEndsAt) : null;

  // cortesia (migration 38): sem cobrança, então nada de assinar, trocar ou pagar
  const hasPending = !plan.grant && !!sub?.asaas_subscription_id && plan.status !== "active" && plan.status !== "past_due";
  const isActive = !plan.grant && (plan.status === "active" || plan.status === "past_due");
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

  if (plan.grant) {
    statusTitle = `Cortesia do plano ${PLAN_NAMES[plan.grant.kind]}`;
    statusText = plan.grant.expiresAt
      ? `Acesso liberado pela Genix, sem cobrança, até ${br(plan.grant.expiresAt)}.`
      : "Acesso vitalício liberado pela Genix, sem cobrança.";
  } else if (plan.internal) {
    statusTitle = "Conta interna";
    statusText = "Esta conta não tem cobrança.";
  } else if (isActive) {
    statusTitle = `${PLAN_NAMES[currentKind]} ${currentCycle} ativo`;
    // valor da próxima cobrança (o mesmo do quadro "Próxima cobrança"): plano da renovação, extras e
    // cupom pelo vencimento (53) — com troca agendada já vem no valor do plano novo
    const renewalAmount = rq ? Number(rq.total) : sub?.amount;
    statusText = plan.currentPeriodEnd
      ? `Próxima renovação em ${br(plan.currentPeriodEnd)}${renewalAmount ? `, no valor de ${brl(renewalAmount)}` : ""}.`
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
    statusText = `Termina em ${trialEnd} (${daysLabel(plan.trialDaysLeft)}). Para continuar com tudo, assine o ${PLAN_NAMES[recommended]}. Sem assinatura, sua conta passa para o Grátis, sem perder nada${freeEnd ? `; o Grátis vale até ${freeEnd}` : ""}.`;
    StatusIcon = Clock;
  } else if (plan.tier === "gratis" && plan.freeOver) {
    statusTitle = "Período Grátis encerrado";
    statusText = `Seu Grátis terminou${freeEnd ? ` em ${freeEnd}` : ""}. O painel e os seus dados continuam, e você pode agendar pelo painel, mas a vitrine não está recebendo agendamentos online. Assine o Básico para voltar a receber.`;
    StatusIcon = XCircle;
  } else if (plan.tier === "gratis") {
    statusTitle = "Plano Grátis";
    statusText = `Vitrine e agenda online com até ${freeLimit} agendamentos online por dia, para 1 profissional.${
      freeEnd && plan.freeDaysLeft !== null
        ? ` Vale até ${freeEnd} (${daysLabel(plan.freeDaysLeft)}). Depois, a vitrine para de receber agendamentos online até você assinar.`
        : ""
    }`;
    StatusIcon = Sparkles;
  }

  // resumo do status: plano atual, prazo do Grátis/teste e próxima cobrança
  const facts: { label: string; value: string; testid: string }[] = [
    { label: "Plano atual", value: PLAN_NAMES[plan.kind], testid: "status-plano-atual" },
  ];
  if (plan.trialDaysLeft !== null && trialEnd) {
    facts.push({ label: "Teste do Equipe", value: `até ${trialEnd} (${daysLabel(plan.trialDaysLeft)})`, testid: "status-dias-teste" });
  }
  if (plan.tier === "gratis" && freeEnd) {
    facts.push({
      label: "Grátis",
      value: plan.freeOver
        ? `encerrado em ${freeEnd}`
        : plan.freeDaysLeft !== null ? `até ${freeEnd} (${daysLabel(plan.freeDaysLeft)})` : `até ${freeEnd}`,
      testid: "status-dias-gratis",
    });
  }
  if (isActive && plan.currentPeriodEnd) {
    facts.push({
      label: "Próxima cobrança",
      value: `${br(plan.currentPeriodEnd)}${rq ? ` · ${brl(Number(rq.total))}` : sub?.amount ? ` · ${brl(sub.amount)}` : ""}`,
      testid: "status-proxima-cobranca",
    });
  }
  // cupom de lançamento (53): até quando vale e o valor depois
  if ((isActive || hasPending) && rq?.discounted && rq.discount_ends_on) {
    facts.push({
      label: rq.coupon_label ?? "Preço de lançamento",
      value: LAUNCH_TEXT.subscribed(br(dayBefore(rq.discount_ends_on)), brl(Number(rq.full_total))),
      testid: "status-desconto",
    });
  }

  // troca entre Básico, Profissional e Equipe (mesmo ciclo)
  const changeTargets = PAID_KINDS.filter((k) => k !== currentKind)
    .map((k) => ({
      kind: k,
      id: planIdFor(k, currentCycle),
      price: quotes ? quotes[k][currentCycle] : null,
      discount: discounts ? discounts[k][currentCycle] : null,
    }))
    .filter((t) => t.price !== null && available.has(t.id));

  // -------------------------------------------------------------------
  // PARTE 3 — Página
  // -------------------------------------------------------------------
  return (
    <main className="mx-auto max-w-3xl space-y-8 p-4 md:p-8">
      <header className="text-center">
        <h1 className="text-3xl md:text-4xl">Assinatura <Ajuda id="assinatura" className="-ml-2" /></h1>
        <p className="mt-1 text-sm text-muted-foreground">Seu plano atual e o que cada plano inclui.</p>
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
        <div className="min-w-0 flex-1">
          <p className="font-heading text-2xl">{statusTitle}</p>
          <p className="mt-1 text-muted-foreground">{statusText}</p>
          {!plan.internal && (
            <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
              {facts.map((f) => (
                <div key={f.label} className="rounded-xl bg-secondary px-3 py-2" data-testid={f.testid}>
                  <dt className="flex items-center text-xs text-muted-foreground">
                    {f.label}
                    {f.testid === "status-desconto" && <Ajuda id="preco-lancamento" className="-my-3 -ml-2" />}
                  </dt>
                  <dd className="font-semibold">{f.value}</dd>
                </div>
              ))}
            </dl>
          )}
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
                Mudança para o <strong>{PLAN_NAMES[kindOfPlanId(sub.upgrade_plan_id)]}</strong> aguardando o pagamento da diferença
                proporcional. Assim que for paga, o plano novo é liberado.
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
                para o <strong>{PLAN_NAMES[kindOfPlanId(sub.scheduled_plan_id)]}</strong>. O que o plano novo não tem fica com
                cadeado{currentKind === "equipe" ? " e os acessos da equipe ficam pausados" : ""}, sem apagar nada.
              </p>
              <div className="mt-2">
                <CancelPlanChangeButton label={`Manter o ${PLAN_NAMES[currentKind]}`} />
              </div>
            </div>
          )}

          {plan.status === "active" && !sub?.upgrade_plan_id && !sub?.scheduled_plan_id && changeTargets.length > 0 && (
            <div className="flex flex-wrap gap-3" data-testid="trocar-plano">
              {changeTargets.map((t) => (
                <ChangePlanButton
                  key={t.id}
                  target={t.id}
                  current={PLAN_NAMES[currentKind]}
                  direction={paidRank(t.kind) > paidRank(currentKind) ? "up" : "down"}
                  price={t.price!}
                  fullPrice={t.discount?.full}
                  discountNote={t.discount?.note}
                  cycle={currentCycle}
                  blockedReason={
                    isSoloKind(t.kind) && activePros > 1
                      ? `Você tem ${activePros} profissionais ativos. Para o ${PLAN_NAMES[t.kind]}, deixe só 1 ativo.`
                      : undefined
                  }
                />
              ))}
            </div>
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
            <h2 className="text-2xl">
              Escolha seu plano
              {discounts && PAID_KINDS.some((k) => discounts[k].mensal || discounts[k].anual) && (
                <Ajuda id="preco-lancamento" className="-ml-1" />
              )}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Você tem {activePros} {activePros === 1 ? "profissional ativo" : "profissionais ativos"}. Anual = 2 meses grátis.
            </p>
          </div>

          {/* Cupom de lançamento (53): automático; o preço com desconto já vem nos valores abaixo */}
          {/* PR 3 (indicação): o aviso de indicação entra aqui */}

          {quotes ? (
            <SubscribeForm
              quotes={quotes}
              discounts={discounts}
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

      {/* Tabela comparativa dos 4 planos (o que inclui e o que NÃO inclui) */}
      <section className="space-y-3" data-testid="comparar-planos">
        <h2 className="text-2xl">Compare os planos</h2>
        <PlansComparison plans={publicPlans} current={plan.internal && !plan.grant ? null : plan.kind} offer={tableOffer} />
      </section>
    </main>
  );
}
