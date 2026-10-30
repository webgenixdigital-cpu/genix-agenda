// Plano atual do estabelecimento (só no servidor)
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

/** Qual plano: Grátis, Profissional (1 pessoa) ou Equipe (teste de 15 dias = Equipe) */
export type PlanKind = "gratis" | "profissional" | "equipe";

export type PlanContext = {
  /** pago/teste × grátis — as checagens de recursos pagos usam este campo */
  tier: "completo" | "gratis";
  /** qual plano pago (recursos de equipe exigem "equipe") */
  kind: PlanKind;
  status: "trialing" | "active" | "past_due" | "canceled" | "expired" | null;
  planId: string | null;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  /** dias restantes do teste (só enquanto o teste está valendo) */
  trialDaysLeft: number | null;
  /** conta interna sem assinatura (seed / demonstração) */
  internal: boolean;
};

export const PLAN_NAMES: Record<PlanKind, string> = {
  gratis: "Grátis",
  profissional: "Profissional",
  equipe: "Equipe",
};

/** Recursos de equipe (acessos individuais, comissões, salão-parceiro) */
export const hasTeamFeatures = (plan: Pick<PlanContext, "kind">) => plan.kind === "equipe";

export const getPlanContext = cache(async (businessId: string): Promise<PlanContext> => {
  const supabase = createClient();

  const [{ data: tier }, { data: kind, error: kindError }, { data: sub }] = await Promise.all([
    supabase.rpc("access_tier", { bid: businessId }),
    supabase.rpc("plan_kind", { bid: businessId }),
    supabase
      .from("subscriptions")
      .select("status, plan_id, trial_ends_at, current_period_end")
      .eq("business_id", businessId)
      .maybeSingle(),
  ]);

  let trialDaysLeft: number | null = null;
  if (sub?.status === "trialing" && sub.trial_ends_at) {
    const ms = new Date(sub.trial_ends_at).getTime() - Date.now();
    if (ms > 0) trialDaysLeft = Math.ceil(ms / 86_400_000);
  }

  const t = tier === "gratis" ? "gratis" : "completo";
  // sem a função plan_kind (migration 28a ainda não aplicada): pago = Equipe
  const k: PlanKind = !kindError && (kind === "gratis" || kind === "profissional" || kind === "equipe")
    ? kind
    : t === "gratis" ? "gratis" : "equipe";

  return {
    tier: t,
    kind: k,
    status: (sub?.status as PlanContext["status"]) ?? null,
    planId: sub?.plan_id ?? null,
    trialEndsAt: sub?.trial_ends_at ?? null,
    currentPeriodEnd: sub?.current_period_end ?? null,
    trialDaysLeft,
    internal: !sub,
  };
});

/** Agendamentos online por dia no Grátis (linha 'gratis' de plans; 10 até a migration 28b) */
export const getFreeDailyLimit = cache(async (): Promise<number> => {
  const { data, error } = await createClient().rpc("free_daily_limit");
  return !error && typeof data === "number" ? data : 10;
});

/** Plano recomendado no fim do teste: 1 profissional ativo → Profissional; 2+ → Equipe */
export const recommendedKind = (activeProfessionals: number): Exclude<PlanKind, "gratis"> =>
  activeProfessionals <= 1 ? "profissional" : "equipe";
