// Planos no SERVIDOR: leitura para as páginas e conferência de plano disponível.
// Nunca importe este arquivo num componente "use client" (usa a chave de serviço no modo de prévia).
//
// Modo de prévia (só local): PLANS_PREVIEW=1 no .env.local + `npm run dev`.
// Trata os planos novos da 28a (gratis, profissional_*, equipe_*) como ativos mesmo com
// active = false no banco, para testar a cobrança no sandbox do Asaas ANTES da 28b.
// Em produção nunca liga: NODE_ENV é conferido aqui, no servidor (`next build`/`next start`
// e a Vercel rodam com NODE_ENV=production).
import { createAdminClient } from "@/lib/supabase/admin";
import { createPublicClient } from "@/lib/supabase/public";
import { createClient } from "@/lib/supabase/server";
import { PAID_PLAN_IDS, type PaidPlanId } from "@/lib/plan-ids";
import { normalizePlans, PLAN_COLUMNS, type Plan } from "@/lib/plans-public";

const NEW_PLAN_IDS = ["gratis", ...PAID_PLAN_IDS];

export function plansPreview() {
  return process.env.PLANS_PREVIEW === "1" && process.env.NODE_ENV !== "production";
}

/** Planos da tabela de preços ("/" e /para/[nicho]) */
export async function getPublicPlans(): Promise<Plan[]> {
  if (plansPreview()) {
    // a RLS só mostra planos ativos: na prévia a leitura usa a chave de serviço (só plans)
    const { data } = await createAdminClient().from("plans").select(PLAN_COLUMNS).in("id", NEW_PLAN_IDS);
    return normalizePlans(data);
  }
  const { data } = await createPublicClient().from("plans").select(PLAN_COLUMNS).eq("active", true);
  return normalizePlans(data);
}

/** Planos pagos que podem ser assinados agora (ativos no banco, ou todos na prévia) */
export async function availablePaidPlans(): Promise<Set<PaidPlanId>> {
  if (plansPreview()) return new Set(PAID_PLAN_IDS);
  const { data } = await createClient().from("plans").select("id").in("id", [...PAID_PLAN_IDS]).eq("active", true);
  return new Set((data ?? []).map((p) => p.id as PaidPlanId));
}
