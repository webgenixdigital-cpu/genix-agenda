// Indique e ganhe (migrations 56 e 61) — SOMENTE NO SERVIDOR (usa a chave de serviço).
// Nunca importe este arquivo num componente "use client".
//
// Prêmio de quem indicou quando o indicado PAGA a 1ª cobrança de um plano pago:
//   • prêmios gerados antes da 61 (kind 'mes'): 1 mês grátis;
//   • da 61 em diante (kind 'credito'): crédito = menor valor entre a mensalidade paga
//     pelo indicado (anual ÷ 12) e a mensalidade de quem indicou (anual: renovação ÷ 12).
//     Crédito >= mensalidade → 1 mês grátis; menor → reduz a próxima cobrança pendente
//     (abaixo de R$ 5 → 1 mês grátis). Cobrança ainda não gerada → o crédito fica guardado
//     e entra quando o Asaas gerar a cobrança (webhook PAYMENT_CREATED).
// O Asaas não aceita cobrança zerada e o campo `discount` é desconto por pagamento
// antecipado (#50), então o mês grátis é um ADIAMENTO:
//   • cada cobrança PENDING da assinatura de quem indicou vai N meses para frente;
//   • a assinatura também (nextDueDate), para as cobranças ainda não geradas;
//   • o valor de cada cobrança é recalculado pelo NOVO vencimento (applySubscriptionValues,
//     que desconta os créditos ligados a cada cobrança; cupom de lançamento: a data final
//     do desconto não muda);
//   • current_period_end vai N meses para frente (o acesso continua).
import { createAdminClient } from "@/lib/supabase/admin";
import { asaas, type AsaasPayment, type AsaasSubscription } from "@/lib/asaas";
import { applySubscriptionValues, billingQuote, referralCreditsFor } from "@/lib/billing";
import { decideCredit, expectedPaymentValue } from "@/lib/referral-credit";

type Admin = ReturnType<typeof createAdminClient>;
type Customer = { id: string; cpfCnpj?: string | null };
type ReferrerSub = {
  status: string;
  plan_id: string | null;
  asaas_subscription_id: string | null;
  asaas_customer_id: string | null;
  current_period_end: string | null;
  upgrade_payment_id: string | null;
};

/** limite de créditos por chamada (cada um fala com o Asaas) */
const MAX_CREDITS_PER_RUN = 12;

/** "2026-12-25" + n meses (dia preservado; 31 → último dia do mês, como o Postgres) */
export function addMonthsISO(ymd: string, n: number) {
  const [y, m, d] = ymd.slice(0, 10).split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return target.toISOString().slice(0, 10);
}

const onlyDigits = (v: string | null | undefined) => (v ?? "").replace(/\D/g, "");

async function customerDoc(customerId: string | null | undefined) {
  if (!customerId) return "";
  const c = await asaas<Customer>(`/customers/${customerId}`).catch(() => null);
  return onlyDigits(c?.cpfCnpj);
}

// ---------------------------------------------------------------------
// PARTE 1 — O indicado pagou uma cobrança da assinatura
// Na 1ª vez gera o prêmio de quem indicou (mesmo CPF/CNPJ = bloqueado) e,
// se quem indicou já tem assinatura paga ativa, aplica na hora.
// value: valor pago de fato nesta cobrança (com o desconto de lançamento).
// ---------------------------------------------------------------------
export async function onReferredPaid(
  businessId: string,
  paymentId: string,
  planId: string | null,
  customerId: string | null | undefined,
  value: number | null | undefined
) {
  if (!planId) return null;
  const admin = createAdminClient();
  const { data: ref } = await admin
    .from("referrals")
    .select("id, referrer_business_id, status")
    .eq("referred_business_id", businessId)
    .maybeSingle();
  if (!ref || ref.status === "bloqueado") return null;
  const { data: existing } = await admin.from("referral_rewards").select("id, status").eq("referral_id", ref.id).maybeSingle();
  if (existing) {
    // aviso repetido (o Asaas tenta de novo quando a 1ª tentativa falhou): termina o que faltou
    if (existing.status === "guardado") await applyReferralRewards(ref.referrer_business_id, "indicado pagou");
    return null;
  }
  if (!(typeof value === "number" && value > 0)) {
    // sem o valor pago não há como calcular o crédito: o Asaas manda de novo (o evento é liberado)
    throw new Error(`Indicação: cobrança ${paymentId} sem valor.`);
  }

  // autoindicação pelo documento (o CPF/CNPJ só existe no Asaas)
  const { data: referrerSub } = await admin
    .from("subscriptions")
    .select("asaas_customer_id")
    .eq("business_id", ref.referrer_business_id)
    .maybeSingle();
  const [mine, theirs] = await Promise.all([customerDoc(customerId), customerDoc(referrerSub?.asaas_customer_id)]);
  const blockReason = mine && theirs && mine === theirs ? "mesmo CPF/CNPJ" : null;

  const { data, error } = await admin.rpc("referral_on_first_payment", {
    bid: businessId,
    p_payment_id: paymentId,
    p_plan: planId,
    p_block_reason: blockReason,
    p_value: value,
  });
  if (error) throw new Error(`Indicação: ${error.message}`);
  const r = data as { reward_id: string; referrer_business_id: string; status: string } | null;
  if (r?.status === "guardado") await applyReferralRewards(r.referrer_business_id, "indicado pagou");
  return r;
}

// ---------------------------------------------------------------------
// PARTE 2 — Usar os prêmios guardados de quem indicou
// Só com assinatura paga ATIVA (a 1ª cobrança precisa ser paga: é ela que ativa
// o plano). Sem isso, os prêmios continuam guardados e são usados no webhook,
// quando a cobrança dele for paga ou gerada.
// ---------------------------------------------------------------------
export async function applyReferralRewards(businessId: string, reason: string): Promise<{ applied: number; credits: number }> {
  const admin = createAdminClient();
  const { data: sub } = await admin
    .from("subscriptions")
    .select("status, plan_id, asaas_subscription_id, asaas_customer_id, current_period_end, upgrade_payment_id")
    .eq("business_id", businessId)
    .maybeSingle<ReferrerSub>();
  // troca anual aguardando pagamento: espera (a renovação ainda vai mudar)
  if (!sub?.asaas_subscription_id || sub.status !== "active" || sub.upgrade_payment_id) return { applied: 0, credits: 0 };

  const months = await applyMonthRewards(admin, businessId, sub, reason);
  const credits = months.failed ? { applied: 0, credits: 0 } : await applyCreditRewards(admin, businessId, sub, reason);
  const applied = months.applied + credits.applied;

  if (applied > 0 || credits.credits > 0) {
    // valores pelo novo vencimento, menos os créditos (cupom de lançamento: o preço segue a data).
    // Falha aqui não desfaz nada: fica "pendente" para o webhook ou o /genix.
    await applySubscriptionValues(businessId, { reason: "indicacao" }).catch(async (e) => {
      console.error("Ajuste de valor depois do prêmio de indicação falhou", businessId, e);
      await admin
        .from("subscriptions")
        .update({ billing_sync_status: "pendente", billing_sync_error: "Ajustar o valor depois do prêmio de indicação." })
        .eq("business_id", businessId);
    });
  }
  return { applied, credits: credits.credits };
}

/** prêmios bloqueados por mesmo CPF/CNPJ (o indicado pagou antes de quem indicou ter CPF no Asaas) */
async function dropSelfReferrals(admin: Admin, sub: ReferrerSub, ids: string[]) {
  const myDoc = await customerDoc(sub.asaas_customer_id);
  if (!myDoc || ids.length === 0) return ids;
  const { data: rows } = await admin.from("referral_rewards").select("id, referrals!inner(referred_business_id)").in("id", ids);
  const referred = (rows ?? []).map((r) => ({
    id: r.id as string,
    bid: (r.referrals as unknown as { referred_business_id: string }).referred_business_id,
  }));
  const { data: subs } = await admin
    .from("subscriptions")
    .select("business_id, asaas_customer_id")
    .in("business_id", referred.map((r) => r.bid));
  const blocked: string[] = [];
  for (const r of referred) {
    const cid = subs?.find((s) => s.business_id === r.bid)?.asaas_customer_id;
    if (cid && (await customerDoc(cid)) === myDoc) blocked.push(r.id);
  }
  if (blocked.length) {
    await admin
      .from("referral_rewards")
      .update({ status: "bloqueado", applied_at: null, note: "Autoindicação: mesmo CPF/CNPJ" })
      .in("id", blocked);
  }
  return ids.filter((id) => !blocked.includes(id));
}

/** adia a próxima cobrança (e as seguintes) n meses. Devolve a cobrança pulada e o vencimento anterior. */
async function shiftMonths(admin: Admin, businessId: string, sub: ReferrerSub, n: number, onTouch: () => void) {
  const subId = sub.asaas_subscription_id as string;
  const s = await asaas<AsaasSubscription>(`/subscriptions/${subId}`);
  const list = await asaas<{ data: AsaasPayment[] }>(`/subscriptions/${subId}/payments?status=PENDING&limit=50`);
  const pending = (list.data ?? []).filter((p) => p.status === "PENDING").sort((a, b) => a.dueDate.localeCompare(b.dueDate));

  // a cobrança "pulada" é a próxima: a pendente mais antiga, ou a próxima a ser gerada
  const first = pending[0] ?? null;
  const dueBefore = first?.dueDate ?? s.nextDueDate;

  // da mais nova para a mais antiga (nunca duas cobranças no mesmo vencimento no meio do caminho)
  for (const p of [...pending].reverse()) {
    onTouch();
    await asaas(`/payments/${p.id}`, { method: "POST", body: { dueDate: addMonthsISO(p.dueDate, n) } });
  }
  onTouch();
  await asaas(`/subscriptions/${subId}`, { method: "POST", body: { nextDueDate: addMonthsISO(s.nextDueDate, n) } });

  // acesso continua pelos meses grátis
  if (sub.current_period_end) {
    const end = new Date(sub.current_period_end);
    const shifted = addMonthsISO(end.toISOString().slice(0, 10), n);
    const current_period_end = `${shifted}T${end.toISOString().slice(11)}`;
    await admin.from("subscriptions").update({ current_period_end }).eq("business_id", businessId);
    sub.current_period_end = current_period_end;
  }
  return { firstId: first?.id ?? null, dueBefore };
}

async function markShiftFailed(admin: Admin, businessId: string, ids: string[], e: unknown) {
  // falhou no meio do adiamento: NÃO devolve (aplicar de novo adiaria duas vezes).
  // Fica registrado para a Genix conferir no Asaas (/genix → Indicações).
  console.error("Prêmio de indicação falhou no meio do adiamento", businessId, e);
  await admin.from("referral_rewards").update({ note: "Falha no meio do adiamento: conferir no Asaas" }).in("id", ids);
  await admin
    .from("subscriptions")
    .update({ billing_sync_status: "pendente", billing_sync_error: "Prêmio de indicação: conferir o adiamento no Asaas." })
    .eq("business_id", businessId);
}

async function planCycle(admin: Admin, planId: string | null) {
  if (!planId) return null;
  const { data } = await admin.from("plans").select("billing_cycle").eq("id", planId).maybeSingle();
  return (data?.billing_cycle as string | undefined) ?? null;
}

// 2a — meses grátis antigos (kind 'mes', 56): todos juntos, N meses
async function applyMonthRewards(admin: Admin, businessId: string, sub: ReferrerSub, reason: string) {
  const { data: claimedRaw } = await admin.rpc("referral_rewards_claim", { bid: businessId });
  let ids = (claimedRaw as string[] | null) ?? [];
  if (ids.length === 0) return { applied: 0, failed: false };

  let touched = false;
  try {
    ids = await dropSelfReferrals(admin, sub, ids);
    if (ids.length === 0) return { applied: 0, failed: false };
    const n = ids.length;
    const { firstId, dueBefore } = await shiftMonths(admin, businessId, sub, n, () => (touched = true));
    const cycle = await planCycle(admin, sub.plan_id);
    // registro de cada prêmio: o k-ésimo leva o vencimento de +(k-1) para +k meses
    for (let k = 0; k < n; k++) {
      await admin
        .from("referral_rewards")
        .update({
          plan_id: sub.plan_id,
          cycle,
          applied_payment_id: firstId,
          due_before: addMonthsISO(dueBefore, k),
          due_after: addMonthsISO(dueBefore, k + 1),
          note: `Mês grátis por indicação (${reason})`,
        })
        .eq("id", ids[k]);
    }
    return { applied: n, failed: false };
  } catch (e) {
    if (!touched) {
      // nada mudou no Asaas: os prêmios voltam a "guardado" e o próximo aviso tenta de novo
      await admin.rpc("referral_rewards_unclaim", { p_ids: ids });
      throw e;
    }
    await markShiftFailed(admin, businessId, ids, e);
    return { applied: 0, failed: true };
  }
}

// 2b — créditos (kind 'credito', 61): um por vez, cada um numa cobrança
async function applyCreditRewards(admin: Admin, businessId: string, sub: ReferrerSub, reason: string) {
  let applied = 0; // créditos que viraram 1 mês grátis
  let credits = 0; // créditos que reduziram uma cobrança
  const subId = sub.asaas_subscription_id as string;

  for (let i = 0; i < MAX_CREDITS_PER_RUN; i++) {
    const { data: claimed } = await admin.rpc("referral_credit_claim", { bid: businessId });
    const c = claimed as { id: string; referred_monthly: number | string } | null;
    if (!c?.id) break;

    let touched = false;
    try {
      if ((await dropSelfReferrals(admin, sub, [c.id])).length === 0) continue;

      const s = await asaas<AsaasSubscription>(`/subscriptions/${subId}`);
      const list = await asaas<{ data: AsaasPayment[] }>(`/subscriptions/${subId}/payments?status=PENDING&limit=50`);
      const pending = (list.data ?? []).filter((p) => p.status === "PENDING").sort((a, b) => a.dueDate.localeCompare(b.dueDate));
      const used = await referralCreditsFor(pending.map((p) => p.id));
      // a próxima cobrança gerada que ainda não tem crédito (1 por cobrança)
      const target = pending.find((p) => !(used[p.id] > 0)) ?? null;

      const q = await billingQuote(businessId, { ref: target?.dueDate ?? s.nextDueDate });
      if (!q) throw new Error("Não foi possível calcular o valor da cobrança.");
      const d = decideCredit(Number(c.referred_monthly), q.total, q.cycle);

      if (d.as === "adiamento") {
        const { firstId, dueBefore } = await shiftMonths(admin, businessId, sub, 1, () => (touched = true));
        await admin
          .from("referral_rewards")
          .update({
            applied_as: "adiamento",
            credit_amount: d.credit,
            plan_id: q.plan,
            cycle: q.cycle,
            applied_payment_id: firstId,
            due_before: dueBefore,
            due_after: addMonthsISO(dueBefore, 1),
            note: `Crédito por indicação: 1 mês grátis (${reason})`,
          })
          .eq("id", c.id);
        applied++;
        continue;
      }

      if (!target) {
        // cobrança ainda não gerada: guarda e espera o PAYMENT_CREATED
        await admin.rpc("referral_rewards_unclaim", { p_ids: [c.id] });
        break;
      }

      // grava ANTES de falar com o Asaas (índice único: 1 crédito por cobrança)
      const { data: reserved } = await admin.rpc("referral_credit_reserve_payment", {
        p_id: c.id,
        p_payment_id: target.id,
        p_due: target.dueDate,
        p_credit: d.credit,
        p_before: d.before,
        p_after: d.after,
        p_plan: q.plan,
        p_cycle: q.cycle,
      });
      if (!reserved) {
        // outro aviso usou esta cobrança agora: devolve e deixa para a próxima
        await admin.rpc("referral_rewards_unclaim", { p_ids: [c.id] });
        break;
      }
      try {
        await asaas(`/payments/${target.id}`, {
          method: "POST",
          body: { value: expectedPaymentValue(q.total, d.credit) },
        });
      } catch (e) {
        // valor absoluto: se o Asaas gravou mesmo assim, o próximo ajuste volta ao preço cheio
        await admin.rpc("referral_credit_release", { p_id: c.id });
        throw e;
      }
      credits++;
    } catch (e) {
      if (!touched) {
        await admin.rpc("referral_rewards_unclaim", { p_ids: [c.id] });
        throw e;
      }
      await markShiftFailed(admin, businessId, [c.id], e);
      break;
    }
  }
  return { applied, credits };
}

// ---------------------------------------------------------------------
// PARTE 3 — Estorno/remoção da 1ª cobrança do indicado: cancela o prêmio não usado
// ---------------------------------------------------------------------
export async function cancelReferralByPayment(paymentId: string) {
  const { data } = await createAdminClient().rpc("referral_cancel_by_payment", { p_payment_id: paymentId });
  return Number(data ?? 0);
}
