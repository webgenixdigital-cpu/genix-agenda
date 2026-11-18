"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { syncSubscriptionBilling } from "@/lib/billing";

type Result = { ok: true } | { ok: false; error: string };

// ---------------------------------------------------------------------
// "Sincronizar agora" (/genix → Assinaturas): lê o valor real no Asaas (assinatura
// e cobranças em aberto) e corrige o que for diferente do esperado para cada
// vencimento (billing_quote; cupom de lançamento, 53).
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

  const r = await syncSubscriptionBilling(businessId, { reason: "genix" });
  revalidatePath("/genix");
  if (r.status === "pendente") return { ok: false, error: r.error ?? "Outra sincronia está em andamento. Tente de novo em instantes." };
  return { ok: true };
}
