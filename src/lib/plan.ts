// Plano atual do estabelecimento (só no servidor)
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

export type PlanContext = {
  tier: "completo" | "gratis";
  status: "trialing" | "active" | "past_due" | "canceled" | "expired" | null;
  planId: string | null;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  /** dias restantes do teste (só enquanto o teste está valendo) */
  trialDaysLeft: number | null;
  /** conta interna sem assinatura (seed / demonstração) */
  internal: boolean;
};

export const getPlanContext = cache(async (businessId: string): Promise<PlanContext> => {
  const supabase = createClient();

  const [{ data: tier }, { data: sub }] = await Promise.all([
    supabase.rpc("access_tier", { bid: businessId }),
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

  return {
    tier: tier === "gratis" ? "gratis" : "completo",
    status: (sub?.status as PlanContext["status"]) ?? null,
    planId: sub?.plan_id ?? null,
    trialEndsAt: sub?.trial_ends_at ?? null,
    currentPeriodEnd: sub?.current_period_end ?? null,
    trialDaysLeft,
    internal: !sub,
  };
});
