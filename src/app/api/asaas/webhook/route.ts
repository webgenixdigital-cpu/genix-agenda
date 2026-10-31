// POST /api/asaas/webhook — avisos de pagamento enviados pelo Asaas.
// Segurança: só aceita requisições com o header "asaas-access-token" igual a ASAAS_WEBHOOK_TOKEN.
// Idempotência: cada evento é gravado pelo id; repetidos são ignorados.
import { timingSafeEqual } from "crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { asaas, type AsaasSubscription } from "@/lib/asaas";

export const dynamic = "force-dynamic";

type AsaasEvent = {
  id?: string;
  event: string;
  payment?: {
    id: string;
    subscription?: string;
    status: string;
    dueDate?: string;
    invoiceUrl?: string;
    billingType?: string;
    value?: number;
    externalReference?: string;
  };
  subscription?: { id: string; status?: string };
};

// ---------------------------------------------------------------------
// PARTE 1 — Autenticação do aviso
// ---------------------------------------------------------------------
function tokenOk(received: string | null) {
  const expected = process.env.ASAAS_WEBHOOK_TOKEN;
  if (!expected || !received) return false;
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

const PAID = ["PAYMENT_CONFIRMED", "PAYMENT_RECEIVED", "PAYMENT_RECEIVED_IN_CASH"];

// ---------------------------------------------------------------------
// PARTE 2 — Recebimento
// ---------------------------------------------------------------------
export async function POST(request: NextRequest) {
  if (!tokenOk(request.headers.get("asaas-access-token"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: AsaasEvent;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ received: true, ignored: "invalid-json" });
  }

  const admin = createAdminClient();
  const subscriptionId = body.payment?.subscription ?? body.subscription?.id ?? null;
  const eventId = body.id ?? `${body.event}:${body.payment?.id ?? subscriptionId}:${body.payment?.status ?? ""}`;

  // Idempotência: grava o evento; se já existir, não processa de novo
  const { error: dupError } = await admin.from("asaas_webhook_events").insert({
    id: eventId,
    event: body.event,
    payment_id: body.payment?.id ?? null,
    subscription_id: subscriptionId,
    payload: body,
  });
  if (dupError) {
    if (dupError.code === "23505") return NextResponse.json({ received: true, duplicate: true });
    return NextResponse.json({ error: "db" }, { status: 500 }); // Asaas tenta de novo
  }

  const finish = async (result: string, businessId?: string) => {
    await admin.from("asaas_webhook_events").update({ result, business_id: businessId ?? null }).eq("id", eventId);
    return NextResponse.json({ received: true, result });
  };

  // Cobrança avulsa da mudança para o Equipe (upgrade anual): paga → vira Equipe
  // e a renovação passa a ter o valor do Equipe
  if (!subscriptionId && body.payment && body.payment.externalReference?.startsWith("upgrade:")) {
    const { data: up } = await admin
      .from("subscriptions")
      .select("business_id, upgrade_plan_id, upgrade_amount, asaas_subscription_id")
      .eq("upgrade_payment_id", body.payment.id)
      .maybeSingle();
    if (!up?.upgrade_plan_id) return finish("ignorado: troca de plano não encontrada");
    if (!PAID.includes(body.event)) return finish(`ignorado: evento ${body.event} da troca de plano`, up.business_id);
    try {
      if (up.asaas_subscription_id && up.upgrade_amount) {
        await asaas(`/subscriptions/${up.asaas_subscription_id}`, {
          method: "POST",
          body: { value: Number(up.upgrade_amount), updatePendingPayments: true },
        });
      }
      await admin
        .from("subscriptions")
        .update({
          plan_id: up.upgrade_plan_id,
          amount: up.upgrade_amount,
          upgrade_plan_id: null,
          upgrade_payment_id: null,
          upgrade_amount: null,
          upgrade_invoice_url: null,
        })
        .eq("business_id", up.business_id);
      return finish(`mudou para ${up.upgrade_plan_id}`, up.business_id);
    } catch (e) {
      await admin.from("asaas_webhook_events").delete().eq("id", eventId);
      console.error("Webhook Asaas (troca de plano) falhou", e);
      return NextResponse.json({ error: "retry" }, { status: 500 });
    }
  }

  if (!subscriptionId) return finish("ignorado: sem assinatura vinculada");

  // Assinatura do Genix Agenda correspondente
  const { data: sub } = await admin
    .from("subscriptions")
    .select("business_id, status, current_period_end, scheduled_plan_id, scheduled_at")
    .eq("asaas_subscription_id", subscriptionId)
    .maybeSingle();
  if (!sub) return finish("ignorado: assinatura não encontrada");

  try {
    // -----------------------------------------------------------------
    // PARTE 3 — Regras por tipo de aviso
    // -----------------------------------------------------------------

    // Pagamento confirmado/recebido → plano pago ativo até a próxima cobrança
    if (PAID.includes(body.event)) {
      const s = await asaas<AsaasSubscription>(`/subscriptions/${subscriptionId}`);
      const periodEnd = s.nextDueDate ? new Date(`${s.nextDueDate}T23:59:59-03:00`).toISOString() : null;

      // troca para o Profissional agendada: vale a partir da 1ª cobrança do ciclo seguinte
      const scheduledFrom = sub.scheduled_at
        ? new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date(sub.scheduled_at))
        : null;
      const applySchedule = !!sub.scheduled_plan_id && !!scheduledFrom && (body.payment?.dueDate ?? "") > scheduledFrom;

      await admin
        .from("subscriptions")
        .update({
          ...(applySchedule
            ? { plan_id: sub.scheduled_plan_id, amount: body.payment?.value ?? s.value, scheduled_plan_id: null, scheduled_at: null }
            : {}),
          status: "active",
          current_period_end: periodEnd,
          pending_invoice_url: null,
          pending_due_date: null,
          canceled_at: null,
        })
        .eq("business_id", sub.business_id);
      return finish(`ativada até ${s.nextDueDate}`, sub.business_id);
    }

    // Nova cobrança (renovação) → guarda o link da próxima fatura
    if (body.event === "PAYMENT_CREATED" && body.payment) {
      await admin
        .from("subscriptions")
        .update({ pending_invoice_url: body.payment.invoiceUrl ?? null, pending_due_date: body.payment.dueDate ?? null })
        .eq("business_id", sub.business_id);
      return finish("fatura registrada", sub.business_id);
    }

    // Cobrança vencida → atraso (só se já era assinante ativo)
    if (body.event === "PAYMENT_OVERDUE") {
      if (sub.status === "active") {
        await admin.from("subscriptions").update({ status: "past_due" }).eq("business_id", sub.business_id);
        return finish("marcada em atraso", sub.business_id);
      }
      return finish("ignorado: vencida antes de virar assinante", sub.business_id);
    }

    // Assinatura removida/inativada no Asaas → cancelada (acesso até o fim do período pago)
    if (body.event === "SUBSCRIPTION_DELETED" || body.event === "SUBSCRIPTION_INACTIVATED") {
      if (sub.status === "active" || sub.status === "past_due") {
        await admin
          .from("subscriptions")
          .update({ status: "canceled", canceled_at: new Date().toISOString(), asaas_subscription_id: null })
          .eq("business_id", sub.business_id);
        return finish("cancelada", sub.business_id);
      }
      return finish("ignorado: não estava ativa", sub.business_id);
    }

    return finish(`ignorado: evento ${body.event}`, sub.business_id);
  } catch (e) {
    // falha ao falar com o Asaas: libera o evento para nova tentativa
    await admin.from("asaas_webhook_events").delete().eq("id", eventId);
    console.error("Webhook Asaas falhou", e);
    return NextResponse.json({ error: "retry" }, { status: 500 });
  }
}
