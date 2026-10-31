"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getEditorContext } from "@/lib/admin";
import { asaas, AsaasError, type AsaasBillingType, type AsaasCustomer, type AsaasPayment, type AsaasSubscription } from "@/lib/asaas";
import { isValidCpfCnpj, onlyDigits } from "@/lib/cpf-cnpj";
import { cycleOfPlanId, isPaidPlanId, kindOfPlanId, type PaidPlanId } from "@/lib/plan-ids";
import { availablePaidPlans } from "@/lib/plans-server";

type Result = { ok: true; invoiceUrl?: string; message?: string } | { ok: false; error: string };
type Quote = { total: number; extra_professionals: number; professionals: number };

// Boleto desativado por enquanto (expõe o documento do recebedor)
const BILLING: AsaasBillingType[] = ["PIX", "CREDIT_CARD"];
const ONLY_OWNER = "Somente o dono do espaço pode alterar a assinatura.";
const PRO_ONE = "O plano Profissional é para 1 profissional ativo. Desative os outros na Equipe ou escolha o plano Equipe.";
const MIN_CHARGE = 5; // menor cobrança avulsa aceita pelo Asaas (R$)
const UNAVAILABLE = "Este plano ainda não está disponível. Tente de novo em instantes.";

const todayISO = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
const kindLabel = (id: string) => (kindOfPlanId(id) === "profissional" ? "Profissional" : "Equipe");
const cycleLabel = (id: string) => (cycleOfPlanId(id) === "anual" ? "anual" : "mensal");
const description = (planId: string, businessName: string) =>
  `Genix Agenda ${kindLabel(planId)} (${cycleLabel(planId)}) - ${businessName}`;

function friendly(e: unknown) {
  if (e instanceof AsaasError) return `Asaas: ${e.message}`;
  return "Não foi possível falar com o sistema de pagamentos. Tente de novo em instantes.";
}

/** valor calculado no banco (inclui profissionais extras do Equipe) */
async function quoteFor(businessId: string, planId: PaidPlanId) {
  const { data } = await createClient().rpc("subscription_quote", { bid: businessId, p_plan: planId });
  return data as Quote | null;
}

function refresh() {
  revalidatePath("/admin/assinatura");
  revalidatePath("/admin", "layout");
}

// ---------------------------------------------------------------------
// PARTE 1 — Assinar (cria cliente + assinatura no Asaas, devolve a fatura)
// ---------------------------------------------------------------------
export async function startSubscription(input: {
  planId: PaidPlanId;
  billingType: AsaasBillingType;
  holderName: string;
  cpfCnpj: string;
}): Promise<Result> {
  const ctx = await getEditorContext();
  if (ctx.role !== "owner") return { ok: false, error: ONLY_OWNER };

  if (!isPaidPlanId(input.planId)) return { ok: false, error: "Escolha o plano." };
  // só planos ativos no banco (ou todos, no modo de prévia local)
  if (!(await availablePaidPlans()).has(input.planId)) return { ok: false, error: UNAVAILABLE };
  if (!BILLING.includes(input.billingType)) return { ok: false, error: "Escolha a forma de pagamento." };
  if (input.holderName.trim().length < 3) return { ok: false, error: "Informe o nome de quem vai pagar." };
  if (!isValidCpfCnpj(input.cpfCnpj)) return { ok: false, error: "CPF ou CNPJ inválido." };

  const admin = createAdminClient();
  const biz = ctx.business;

  const q = await quoteFor(biz.id, input.planId);
  if (!q) return { ok: false, error: "Não foi possível calcular o valor do plano." };
  if (kindOfPlanId(input.planId) === "profissional" && q.professionals > 1) return { ok: false, error: PRO_ONE };

  const { data: sub } = await admin
    .from("subscriptions")
    .select("status, trial_ends_at, asaas_customer_id, asaas_subscription_id")
    .eq("business_id", biz.id)
    .maybeSingle();
  if (!sub) return { ok: false, error: "Esta conta não possui assinatura configurável." };
  if (sub.status === "active") return { ok: false, error: "Sua assinatura já está ativa." };
  if (sub.asaas_subscription_id) {
    return { ok: false, error: "Já existe um pagamento pendente. Abra a fatura ou cancele para trocar de plano." };
  }

  try {
    // 1) cliente no Asaas (reaproveita se já existir)
    const customerBody = {
      name: input.holderName.trim(),
      cpfCnpj: onlyDigits(input.cpfCnpj),
      email: ctx.email,
      mobilePhone: (biz.whatsapp ?? "").replace(/^55/, "") || undefined,
      externalReference: biz.id,
    };
    let customerId = sub.asaas_customer_id as string | null;
    if (customerId) {
      await asaas(`/customers/${customerId}`, { method: "PUT", body: customerBody });
    } else {
      const c = await asaas<AsaasCustomer>("/customers", { method: "POST", body: customerBody });
      customerId = c.id;
    }

    // 2) assinatura: 1ª cobrança vence no fim do teste (ou hoje, se já acabou)
    const trialEnd = sub.trial_ends_at
      ? new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date(sub.trial_ends_at))
      : todayISO();
    const nextDueDate = trialEnd > todayISO() ? trialEnd : todayISO();

    const s = await asaas<AsaasSubscription>("/subscriptions", {
      method: "POST",
      body: {
        customer: customerId,
        billingType: input.billingType,
        value: Number(q.total),
        nextDueDate,
        cycle: cycleOfPlanId(input.planId) === "anual" ? "YEARLY" : "MONTHLY",
        description: description(input.planId, biz.name),
        externalReference: biz.id,
      },
    });

    // 3) primeira fatura gerada pela assinatura
    const payments = await asaas<{ data: AsaasPayment[] }>(`/subscriptions/${s.id}/payments`);
    const first = payments.data?.[0];

    await admin
      .from("subscriptions")
      .update({
        plan_id: input.planId,
        amount: q.total,
        extra_professionals: q.extra_professionals,
        billing_type: input.billingType,
        asaas_customer_id: customerId,
        asaas_subscription_id: s.id,
        pending_invoice_url: first?.invoiceUrl ?? null,
        pending_due_date: first?.dueDate ?? nextDueDate,
        scheduled_plan_id: null,
        scheduled_at: null,
        // cobrança do extra (29): a 1ª fatura já cobre os extras de agora
        billed_extra_professionals: q.extra_professionals,
        billing_sync_status: "ok",
        billing_sync_error: null,
      })
      .eq("business_id", biz.id);

    revalidatePath("/admin/assinatura");
    return { ok: true, invoiceUrl: first?.invoiceUrl };
  } catch (e) {
    return { ok: false, error: friendly(e) };
  }
}

// ---------------------------------------------------------------------
// PARTE 2 — Cancelar
// Pendente (nunca pagou): desfaz e volta ao estado anterior.
// Ativa: cancela a renovação; o acesso continua até o fim do período pago.
// ---------------------------------------------------------------------
export async function cancelSubscription(): Promise<Result> {
  const ctx = await getEditorContext();
  if (ctx.role !== "owner") return { ok: false, error: ONLY_OWNER };

  const admin = createAdminClient();
  const { data: sub } = await admin
    .from("subscriptions")
    .select("status, asaas_subscription_id, upgrade_payment_id")
    .eq("business_id", ctx.business.id)
    .maybeSingle();
  if (!sub?.asaas_subscription_id) return { ok: false, error: "Não há assinatura para cancelar." };

  try {
    await asaas(`/subscriptions/${sub.asaas_subscription_id}`, { method: "DELETE" });
    if (sub.upgrade_payment_id) await asaas(`/payments/${sub.upgrade_payment_id}`, { method: "DELETE" }).catch(() => null);
  } catch (e) {
    // 404 = já removida no Asaas; segue para limpar aqui
    if (!(e instanceof AsaasError && e.status === 404)) return { ok: false, error: friendly(e) };
  }

  const wasPaid = sub.status === "active" || sub.status === "past_due";
  const clearChanges = {
    scheduled_plan_id: null, scheduled_at: null,
    upgrade_plan_id: null, upgrade_payment_id: null, upgrade_amount: null, upgrade_invoice_url: null,
    billing_sync_status: "ok", billing_sync_error: null,
  };
  await admin
    .from("subscriptions")
    .update(
      wasPaid
        ? { status: "canceled", canceled_at: new Date().toISOString(), asaas_subscription_id: null, pending_invoice_url: null, pending_due_date: null, ...clearChanges }
        : { plan_id: null, amount: null, billing_type: null, asaas_subscription_id: null, pending_invoice_url: null, pending_due_date: null, ...clearChanges }
    )
    .eq("business_id", ctx.business.id);

  refresh();
  return { ok: true };
}

// ---------------------------------------------------------------------
// PARTE 3 — Trocar entre Profissional e Equipe (mesmo ciclo)
// Upgrade mensal: vale na hora; o novo valor entra na próxima cobrança.
// Upgrade anual: cobrança avulsa proporcional; vira Equipe quando pagar (webhook).
// Downgrade: vale no próximo ciclo (o valor da renovação já muda no Asaas).
// ---------------------------------------------------------------------
export async function changePlan(target: PaidPlanId): Promise<Result> {
  const ctx = await getEditorContext();
  if (ctx.role !== "owner") return { ok: false, error: ONLY_OWNER };
  if (!isPaidPlanId(target)) return { ok: false, error: "Plano inválido." };
  if (!(await availablePaidPlans()).has(target)) return { ok: false, error: UNAVAILABLE };

  const admin = createAdminClient();
  const biz = ctx.business;
  const { data: sub } = await admin
    .from("subscriptions")
    .select("status, plan_id, amount, billing_type, current_period_end, asaas_customer_id, asaas_subscription_id, upgrade_payment_id")
    .eq("business_id", biz.id)
    .maybeSingle();
  if (!sub?.asaas_subscription_id || sub.status !== "active") {
    return { ok: false, error: "A troca de plano é feita com a assinatura ativa e em dia." };
  }
  if (sub.upgrade_payment_id) return { ok: false, error: "Já existe uma troca de plano aguardando pagamento." };
  if (cycleOfPlanId(sub.plan_id) !== cycleOfPlanId(target)) {
    return { ok: false, error: "Para trocar entre mensal e anual, cancele e assine de novo." };
  }

  const from = kindOfPlanId(sub.plan_id);
  const to = kindOfPlanId(target);
  if (from === to) return { ok: false, error: "Você já está neste plano." };

  const q = await quoteFor(biz.id, target);
  if (!q) return { ok: false, error: "Não foi possível calcular o valor do plano." };

  try {
    // ---------- Downgrade: Equipe → Profissional, no próximo ciclo ----------
    if (to === "profissional") {
      if (q.professionals > 1) return { ok: false, error: PRO_ONE };
      await asaas(`/subscriptions/${sub.asaas_subscription_id}`, {
        method: "POST",
        body: { value: Number(q.total), description: description(target, biz.name), updatePendingPayments: true },
      });
      await admin
        .from("subscriptions")
        .update({ scheduled_plan_id: target, scheduled_at: new Date().toISOString() })
        .eq("business_id", biz.id);
      refresh();
      return { ok: true, message: "Troca agendada: o plano Profissional começa na próxima renovação." };
    }

    // ---------- Upgrade: Profissional → Equipe ----------
    const updateRenewal = () =>
      asaas(`/subscriptions/${sub.asaas_subscription_id}`, {
        method: "POST",
        body: { value: Number(q.total), description: description(target, biz.name), updatePendingPayments: true },
      });

    // diferença proporcional aos dias que faltam (só no anual)
    const msLeft = sub.current_period_end ? new Date(sub.current_period_end).getTime() - Date.now() : 0;
    const daysLeft = Math.max(0, Math.ceil(msLeft / 86_400_000));
    const diff = Math.round(Math.max(0, Number(q.total) - Number(sub.amount ?? 0)) * (daysLeft / 365) * 100) / 100;

    if (cycleOfPlanId(target) === "mensal" || diff < MIN_CHARGE) {
      await updateRenewal();
      await admin
        .from("subscriptions")
        .update({ plan_id: target, amount: q.total, extra_professionals: q.extra_professionals, scheduled_plan_id: null, scheduled_at: null })
        .eq("business_id", biz.id);
      refresh();
      return { ok: true, message: "Pronto! Você já está no plano Equipe. O novo valor vale a partir da próxima cobrança." };
    }

    const payment = await asaas<AsaasPayment>("/payments", {
      method: "POST",
      body: {
        customer: sub.asaas_customer_id,
        billingType: sub.billing_type === "CREDIT_CARD" ? "CREDIT_CARD" : "PIX",
        value: diff,
        dueDate: todayISO(),
        description: `Genix Agenda: mudança para o plano Equipe (proporcional a ${daysLeft} dias) - ${biz.name}`,
        externalReference: `upgrade:${biz.id}`,
      },
    });
    await admin
      .from("subscriptions")
      .update({
        upgrade_plan_id: target,
        upgrade_payment_id: payment.id,
        upgrade_amount: q.total,
        upgrade_invoice_url: payment.invoiceUrl,
        scheduled_plan_id: null,
        scheduled_at: null,
      })
      .eq("business_id", biz.id);
    refresh();
    return { ok: true, invoiceUrl: payment.invoiceUrl };
  } catch (e) {
    return { ok: false, error: friendly(e) };
  }
}

// ---------------------------------------------------------------------
// PARTE 4 — Desistir de uma troca (agendada ou aguardando pagamento)
// ---------------------------------------------------------------------
export async function cancelPlanChange(): Promise<Result> {
  const ctx = await getEditorContext();
  if (ctx.role !== "owner") return { ok: false, error: ONLY_OWNER };

  const admin = createAdminClient();
  const biz = ctx.business;
  const { data: sub } = await admin
    .from("subscriptions")
    .select("plan_id, amount, asaas_subscription_id, scheduled_plan_id, upgrade_payment_id")
    .eq("business_id", biz.id)
    .maybeSingle();
  if (!sub) return { ok: false, error: "Não há troca de plano para desfazer." };

  try {
    if (sub.upgrade_payment_id) {
      await asaas(`/payments/${sub.upgrade_payment_id}`, { method: "DELETE" }).catch((e) => {
        if (!(e instanceof AsaasError && e.status === 404)) throw e;
      });
    }
    // downgrade agendado: a renovação volta ao valor atual
    if (sub.scheduled_plan_id && sub.asaas_subscription_id && sub.plan_id) {
      await asaas(`/subscriptions/${sub.asaas_subscription_id}`, {
        method: "POST",
        body: { value: Number(sub.amount), description: description(sub.plan_id, biz.name), updatePendingPayments: true },
      });
    }
  } catch (e) {
    return { ok: false, error: friendly(e) };
  }

  await admin
    .from("subscriptions")
    .update({
      scheduled_plan_id: null, scheduled_at: null,
      upgrade_plan_id: null, upgrade_payment_id: null, upgrade_amount: null, upgrade_invoice_url: null,
    })
    .eq("business_id", biz.id);
  refresh();
  return { ok: true };
}
