"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getEditorContext } from "@/lib/admin";
import { asaas, AsaasError, type AsaasBillingType, type AsaasCustomer, type AsaasPayment, type AsaasSubscription } from "@/lib/asaas";
import { isValidCpfCnpj, onlyDigits } from "@/lib/cpf-cnpj";

type Result = { ok: true; invoiceUrl?: string } | { ok: false; error: string };

// Boleto desativado por enquanto (expõe o documento do recebedor)
const BILLING: AsaasBillingType[] = ["PIX", "CREDIT_CARD"];
const ONLY_OWNER = "Somente o dono do espaço pode alterar a assinatura.";

const todayISO = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());

function friendly(e: unknown) {
  if (e instanceof AsaasError) return `Asaas: ${e.message}`;
  return "Não foi possível falar com o sistema de pagamentos. Tente de novo em instantes.";
}

// ---------------------------------------------------------------------
// PARTE 1 — Assinar (cria cliente + assinatura no Asaas, devolve a fatura)
// ---------------------------------------------------------------------
export async function startSubscription(input: {
  planId: "mensal" | "anual";
  billingType: AsaasBillingType;
  holderName: string;
  cpfCnpj: string;
}): Promise<Result> {
  const ctx = await getEditorContext();
  if (ctx.role !== "owner") return { ok: false, error: ONLY_OWNER };

  if (!["mensal", "anual"].includes(input.planId)) return { ok: false, error: "Escolha o plano." };
  if (!BILLING.includes(input.billingType)) return { ok: false, error: "Escolha a forma de pagamento." };
  if (input.holderName.trim().length < 3) return { ok: false, error: "Informe o nome de quem vai pagar." };
  if (!isValidCpfCnpj(input.cpfCnpj)) return { ok: false, error: "CPF ou CNPJ inválido." };

  const supabase = createClient();
  const admin = createAdminClient();
  const biz = ctx.business;

  // valor calculado no banco (inclui profissionais extras)
  const { data: quote } = await supabase.rpc("subscription_quote", { bid: biz.id, p_plan: input.planId });
  const q = quote as { total: number; extra_professionals: number } | null;
  if (!q) return { ok: false, error: "Não foi possível calcular o valor do plano." };

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
        cycle: input.planId === "anual" ? "YEARLY" : "MONTHLY",
        description: `Genix Agenda Completo (${input.planId === "anual" ? "anual" : "mensal"}) - ${biz.name}`,
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
    .select("status, asaas_subscription_id")
    .eq("business_id", ctx.business.id)
    .maybeSingle();
  if (!sub?.asaas_subscription_id) return { ok: false, error: "Não há assinatura para cancelar." };

  try {
    await asaas(`/subscriptions/${sub.asaas_subscription_id}`, { method: "DELETE" });
  } catch (e) {
    // 404 = já removida no Asaas; segue para limpar aqui
    if (!(e instanceof AsaasError && e.status === 404)) return { ok: false, error: friendly(e) };
  }

  const wasPaid = sub.status === "active" || sub.status === "past_due";
  await admin
    .from("subscriptions")
    .update(
      wasPaid
        ? { status: "canceled", canceled_at: new Date().toISOString(), asaas_subscription_id: null, pending_invoice_url: null, pending_due_date: null }
        : { plan_id: null, amount: null, billing_type: null, asaas_subscription_id: null, pending_invoice_url: null, pending_due_date: null }
    )
    .eq("business_id", ctx.business.id);

  revalidatePath("/admin/assinatura");
  revalidatePath("/admin", "layout");
  return { ok: true };
}
