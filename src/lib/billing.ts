// Cobrança do profissional extra (SOMENTE NO SERVIDOR — usa a chave de serviço).
// Uma rotina só recalcula e sincroniza o valor da assinatura no Asaas quando a equipe
// ativa muda: actions da Equipe, webhook do Asaas e o botão "Sincronizar agora" do /genix.
//
// Regras (migration 29):
//   • valor = billing_quote no banco (plano da próxima renovação + extras além do incluso);
//   • mensal: só muda o valor da assinatura (updatePendingPayments), sem proporcional;
//   • anual: cada extra novo no período gera avulsa proporcional (dias restantes ÷ 365),
//     abaixo de R$ 5 não cobra; desativar só reduz a renovação (sem reembolso);
//   • 1ª fatura ainda não paga (assinou no teste): só muda o valor dela, sem avulsa;
//   • falha do Asaas nunca bloqueia a ativação: a assinatura fica "pendente" e
//     a próxima ação, o webhook ou o /genix tentam de novo.
// Nunca importe este arquivo num componente "use client".
import { createAdminClient } from "@/lib/supabase/admin";
import { asaas, AsaasError, type AsaasPayment } from "@/lib/asaas";
import { todayISO } from "@/lib/dates";
import { brl } from "@/lib/format";
import { kindOfPlanId } from "@/lib/plan-ids";

/** menor cobrança avulsa aceita pelo Asaas (R$) */
export const MIN_CHARGE = 5;

export const EXTRA_OVERDUE =
  "Há uma cobrança de profissional extra em aberto. Pague a fatura na Assinatura para ativar novos profissionais.";
export const SCHEDULED_DOWNGRADE =
  "Você agendou a troca para o plano Profissional (1 profissional). Para ativar mais alguém, desfaça a troca agendada na Assinatura.";

export type BillingQuote = {
  plan: string;
  cycle: "MONTHLY" | "YEARLY";
  kind: string;
  base_price: number;
  included: number;
  professionals: number;
  extra_professionals: number;
  extra_price: number;
  total: number;
};

type Sub = {
  status: string;
  trial_ends_at: string | null;
  plan_id: string | null;
  scheduled_plan_id: string | null;
  amount: number | null;
  billing_type: string | null;
  current_period_end: string | null;
  asaas_customer_id: string | null;
  asaas_subscription_id: string | null;
  upgrade_payment_id: string | null;
  billed_extra_professionals: number | null;
};

const SUB_COLUMNS =
  "status, trial_ends_at, plan_id, scheduled_plan_id, amount, billing_type, current_period_end, asaas_customer_id, asaas_subscription_id, upgrade_payment_id, billed_extra_professionals";

const round2 = (n: number) => Math.round(n * 100) / 100;
const sameValue = (a: number, b: number) => Math.round(a * 100) === Math.round(b * 100);
/** assinou mas ainda não pagou a 1ª fatura (ex.: assinou durante o teste) */
const firstInvoicePending = (s: Sub) => s.status !== "active" && s.status !== "past_due";

function daysLeftOf(periodEnd: string | null) {
  const ms = periodEnd ? new Date(periodEnd).getTime() - Date.now() : 0;
  return Math.max(0, Math.ceil(ms / 86_400_000));
}

/** avulsa do anual: extras novos × preço anual do extra × dias restantes ÷ 365 */
function prorata(extras: number, extraPrice: number, periodEnd: string | null) {
  return round2(extras * extraPrice * (daysLeftOf(periodEnd) / 365));
}

const teamLabel = (q: BillingQuote) =>
  `${q.professionals} ${q.professionals === 1 ? "profissional" : "profissionais"} (${q.included} inclusos` +
  (q.extra_professionals > 0 ? ` + ${q.extra_professionals} ${q.extra_professionals === 1 ? "extra" : "extras"})` : ")");

// ---------------------------------------------------------------------
// PARTE 1 — Valor calculado no banco
// ---------------------------------------------------------------------
export async function billingQuote(
  businessId: string,
  opts: { plan?: string; professionals?: number } = {}
): Promise<BillingQuote | null> {
  const { data, error } = await createAdminClient().rpc("billing_quote", {
    bid: businessId,
    p_plan: opts.plan ?? null,
    p_professionals: opts.professionals ?? null,
  });
  if (error || !data) return null;
  const q = data as Record<string, unknown>;
  return {
    plan: String(q.plan),
    cycle: q.cycle === "YEARLY" ? "YEARLY" : "MONTHLY",
    kind: String(q.kind),
    base_price: Number(q.base_price),
    included: Number(q.included),
    professionals: Number(q.professionals),
    extra_professionals: Number(q.extra_professionals),
    extra_price: Number(q.extra_price),
    total: Number(q.total),
  };
}

// ---------------------------------------------------------------------
// PARTE 2 — Aviso antes de ativar/desativar (a matriz confirma)
// expected = valor da assinatura depois da mudança; a action confere que
// é o mesmo valor que a matriz viu.
// ---------------------------------------------------------------------
export type BillingPreview = { ok: true; message: string | null; expected: number | null } | { ok: false; error: string };

const NONE: BillingPreview = { ok: true, message: null, expected: null };

export async function previewTeamChange(businessId: string, delta: 1 | -1): Promise<BillingPreview> {
  const admin = createAdminClient();
  const [{ data: sub }, { count }] = await Promise.all([
    admin.from("subscriptions").select(SUB_COLUMNS).eq("business_id", businessId).maybeSingle<Sub>(),
    admin.from("professionals").select("id", { count: "exact", head: true }).eq("business_id", businessId).eq("active", true),
  ]);
  if (!sub) return NONE; // conta interna: sem cobrança

  const now = count ?? 0;
  const next = now + delta;

  if (delta > 0) {
    const { data: overdue } = await admin.rpc("billing_extra_overdue", { bid: businessId });
    if (overdue) return { ok: false, error: EXTRA_OVERDUE };
    if (now >= 1 && sub.scheduled_plan_id && kindOfPlanId(sub.scheduled_plan_id) === "profissional") {
      return { ok: false, error: SCHEDULED_DOWNGRADE };
    }
  }

  // Teste sem assinatura: só informa o valor futuro do Equipe
  if (!sub.asaas_subscription_id) {
    // cancelada, Grátis ou teste vencido: sem cobrança e sem aviso
    if (sub.status !== "trialing" || !sub.trial_ends_at || new Date(sub.trial_ends_at).getTime() <= Date.now()) return NONE;
    const [m0, m1, a1] = await Promise.all([
      billingQuote(businessId, { plan: "equipe_mensal", professionals: now }),
      billingQuote(businessId, { plan: "equipe_mensal", professionals: next }),
      billingQuote(businessId, { plan: "equipe_anual", professionals: next }),
    ]);
    if (!m0 || !m1 || !a1 || sameValue(m0.total, m1.total)) return NONE;
    return {
      ok: true,
      expected: m1.total,
      message: `Durante o teste não há cobrança. Com ${teamLabel(m1)}, o plano Equipe fica ${brl(m1.total)}/mês ou ${brl(a1.total)}/ano quando você assinar.`,
    };
  }

  // cancelada (acesso até o fim do período) ou troca anual aguardando pagamento: sem aviso
  if (sub.status === "canceled" || sub.status === "expired" || sub.upgrade_payment_id) return NONE;

  const [q0, q1] = await Promise.all([billingQuote(businessId), billingQuote(businessId, { professionals: next })]);
  if (!q0 || !q1 || sameValue(q0.total, q1.total)) return NONE; // dentro do incluso (ou Profissional)

  const base = { ok: true as const, expected: q1.total };
  if (firstInvoicePending(sub)) return { ...base, message: `Sua primeira cobrança passa a ${brl(q1.total)} (${teamLabel(q1)}).` };
  if (delta < 0) return { ...base, message: `A assinatura cai para ${brl(q1.total)} a partir da próxima cobrança.` };
  if (q1.cycle === "MONTHLY") {
    return { ...base, message: `Isso acrescenta ${brl(round2(q1.total - q0.total))}/mês à sua assinatura (a partir da próxima cobrança).` };
  }

  const newExtras = q1.extra_professionals - (sub.billed_extra_professionals ?? 0);
  const value = newExtras > 0 ? prorata(newExtras, q1.extra_price, sub.current_period_end) : 0;
  if (value >= MIN_CHARGE) {
    return {
      ...base,
      message: `Será gerada uma cobrança de ${brl(value)} proporcional aos dias restantes; a renovação passa a ${brl(q1.total)}.`,
    };
  }
  return {
    ...base,
    message:
      `A renovação passa a ${brl(q1.total)}.` +
      (newExtras <= 0 ? " Este profissional extra já está pago neste período." : ""),
  };
}

// ---------------------------------------------------------------------
// PARTE 3 — Sincronizar com o Asaas
// observedValue: valor visto no Asaas (webhook "cobrança criada" ou /genix);
// se for diferente do esperado, a assinatura é corrigida mesmo que o valor
// gravado aqui esteja certo.
// ---------------------------------------------------------------------
export type SyncResult = { status: "ok" | "pendente" | "sem-assinatura"; error?: string };

export async function syncSubscriptionBilling(
  businessId: string,
  opts: { reason: string; professionalIds?: string[]; observedValue?: number }
): Promise<SyncResult> {
  const admin = createAdminClient();
  const subscriptions = () => admin.from("subscriptions");

  const { data: head } = await subscriptions().select("asaas_subscription_id").eq("business_id", businessId).maybeSingle();
  if (!head?.asaas_subscription_id) return { status: "sem-assinatura" };

  // trava por assinatura: quem não pega deixa "pendente"; quem tem a trava
  // recalcula no fim e repete se a equipe mudou no meio do caminho
  const { data: locked } = await admin.rpc("billing_try_lock", { bid: businessId });
  if (!locked) {
    await subscriptions().update({ billing_sync_status: "pendente" }).eq("business_id", businessId);
    return { status: "pendente" };
  }

  let observed = opts.observedValue;
  try {
    let stable = false;
    for (let round = 0; round < 3 && !stable; round++) {
      const { data: sub } = await subscriptions().select(SUB_COLUMNS).eq("business_id", businessId).maybeSingle<Sub>();
      // sem renovação (cancelada) ou troca anual aguardando pagamento: nada a ajustar agora
      if (!sub?.asaas_subscription_id || sub.status === "canceled" || sub.status === "expired" || sub.upgrade_payment_id) {
        stable = true;
        break;
      }

      const q = await billingQuote(businessId);
      if (!q) throw new Error("Não foi possível calcular o valor da assinatura.");
      const billed = sub.billed_extra_professionals ?? 0;

      if (firstInvoicePending(sub)) {
        // a 1ª fatura cobre todos os extras do ano/mês: nenhuma avulsa
        if (billed !== q.extra_professionals) {
          await subscriptions().update({ billed_extra_professionals: q.extra_professionals }).eq("business_id", businessId);
        }
      } else if (q.cycle === "YEARLY" && q.extra_professionals > billed) {
        // anual em andamento: avulsa proporcional para os extras ainda não cobrados no período
        const newExtras = q.extra_professionals - billed;
        const value = prorata(newExtras, q.extra_price, sub.current_period_end);
        let payment: AsaasPayment | null = null;
        if (value >= MIN_CHARGE) {
          const { data: biz } = await admin.from("businesses").select("name").eq("id", businessId).maybeSingle();
          payment = await asaas<AsaasPayment>("/payments", {
            method: "POST",
            body: {
              customer: sub.asaas_customer_id,
              billingType: sub.billing_type === "CREDIT_CARD" ? "CREDIT_CARD" : "PIX",
              value,
              dueDate: todayISO(),
              description:
                `Genix Agenda: ${newExtras} ${newExtras === 1 ? "profissional extra" : "profissionais extras"} ` +
                `(proporcional a ${daysLeftOf(sub.current_period_end)} dias) - ${biz?.name ?? ""}`,
              externalReference: `extra:${businessId}`,
            },
          });
        }
        // grava antes de mexer na renovação: estes extras nunca são cobrados de novo no período
        await subscriptions().update({ billed_extra_professionals: q.extra_professionals }).eq("business_id", businessId);
        if (payment) {
          await admin.from("subscription_billing_changes").insert({
            business_id: businessId,
            kind: "avulsa",
            reason: opts.reason,
            professionals: q.professionals,
            extra_professionals: q.extra_professionals,
            old_amount: sub.amount,
            new_amount: q.total,
            professional_ids: await pickExtraIds(businessId, newExtras, opts.professionalIds),
            payment_id: payment.id,
            payment_value: value,
            payment_due_date: payment.dueDate,
            payment_status: "PENDING",
            invoice_url: payment.invoiceUrl,
          });
        }
      }

      // valor da renovação (e da fatura pendente)
      const current = observed ?? Number(sub.amount ?? 0);
      if (!sameValue(current, q.total)) {
        await asaas(`/subscriptions/${sub.asaas_subscription_id}`, {
          method: "POST",
          body: { value: q.total, updatePendingPayments: true },
        });
        await subscriptions()
          .update({ amount: q.total, extra_professionals: q.extra_professionals })
          .eq("business_id", businessId);
        await admin.from("subscription_billing_changes").insert({
          business_id: businessId,
          kind: "valor",
          reason: opts.reason,
          professionals: q.professionals,
          extra_professionals: q.extra_professionals,
          old_amount: current,
          new_amount: q.total,
        });
      }
      observed = undefined;

      // a equipe mudou enquanto falávamos com o Asaas? mais uma volta
      const again = await billingQuote(businessId);
      stable = !!again && sameValue(again.total, q.total) && again.extra_professionals === q.extra_professionals;
    }

    if (!stable) throw new Error("A equipe mudou várias vezes seguidas. Tente sincronizar de novo.");
    await subscriptions()
      .update({ billing_sync_status: "ok", billing_sync_error: null, billing_synced_at: new Date().toISOString() })
      .eq("business_id", businessId);
    return { status: "ok" };
  } catch (e) {
    const error = e instanceof AsaasError ? `Asaas: ${e.message}` : e instanceof Error ? e.message : "Erro desconhecido";
    console.error("Sincronia da cobrança falhou", businessId, e);
    await subscriptions()
      .update({ billing_sync_status: "pendente", billing_sync_error: error.slice(0, 500) })
      .eq("business_id", businessId);
    return { status: "pendente", error };
  } finally {
    await subscriptions().update({ billing_lock_until: null }).eq("business_id", businessId);
  }
}

/** quem entra como extra na avulsa: quem acabou de ser ativado; depois, os últimos da lista */
async function pickExtraIds(businessId: string, n: number, preferred: string[] = []) {
  const { data } = await createAdminClient()
    .from("professionals")
    .select("id")
    .eq("business_id", businessId)
    .eq("active", true)
    .order("sort_order", { ascending: false });
  const active = (data ?? []).map((p) => p.id as string);
  const first = preferred.filter((id) => active.includes(id));
  return [...first, ...active.filter((id) => !first.includes(id))].slice(0, n);
}

/** depois de uma mudança na equipe: tenta sincronizar se a assinatura ficou pendente */
export async function syncIfPending(businessId: string, reason: string, professionalIds?: string[]) {
  const { data } = await createAdminClient()
    .from("subscriptions")
    .select("billing_sync_status")
    .eq("business_id", businessId)
    .maybeSingle();
  if (data?.billing_sync_status !== "pendente") return null;
  return syncSubscriptionBilling(businessId, { reason, professionalIds });
}
