"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { asaas, AsaasError, type AsaasSubscription } from "@/lib/asaas";
import { syncSubscriptionBilling } from "@/lib/billing";

type Result = { ok: true } | { ok: false; error: string };

// ---------------------------------------------------------------------
// "Sincronizar agora" (/genix → Assinaturas): lê o valor real no Asaas e
// corrige a assinatura se for diferente do esperado (billing_quote).
// ---------------------------------------------------------------------
export async function syncBillingNow(businessId: string): Promise<Result> {
  const { data: isAdmin } = await createClient().rpc("is_platform_admin");
  if (!isAdmin) return { ok: false, error: "Acesso negado." };

  const { data: sub } = await createAdminClient()
    .from("subscriptions")
    .select("asaas_subscription_id")
    .eq("business_id", businessId)
    .maybeSingle();
  if (!sub?.asaas_subscription_id) return { ok: false, error: "Este espaço não tem assinatura no Asaas." };

  let observed: number;
  try {
    const s = await asaas<AsaasSubscription>(`/subscriptions/${sub.asaas_subscription_id}`);
    observed = Number(s.value);
  } catch (e) {
    return { ok: false, error: e instanceof AsaasError ? `Asaas: ${e.message}` : "Não foi possível falar com o Asaas." };
  }

  const r = await syncSubscriptionBilling(businessId, { reason: "genix", observedValue: observed });
  revalidatePath("/genix");
  if (r.status === "pendente") return { ok: false, error: r.error ?? "Outra sincronia está em andamento. Tente de novo em instantes." };
  return { ok: true };
}
