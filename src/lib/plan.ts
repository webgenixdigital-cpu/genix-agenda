// Plano atual do estabelecimento (só no servidor)
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { planAllows, type PlanKind } from "@/lib/plan-features";

export { planAllows, PLAN_NAMES, type PlanKind } from "@/lib/plan-features";

export type PlanContext = {
  /** pago/teste/cortesia × grátis (access_tier). Recursos do Básico em diante = "completo" */
  tier: "completo" | "gratis";
  /** qual plano (plan_kind): use planAllows(plan, "basico" | "profissional" | "equipe") */
  kind: PlanKind;
  status: "trialing" | "active" | "past_due" | "canceled" | "expired" | null;
  planId: string | null;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  /** dias restantes do teste (só enquanto o teste está valendo) */
  trialDaysLeft: number | null;
  /** conta sem cobrança: sem assinatura (seed / demonstração) ou com cortesia */
  internal: boolean;
  /** cortesia concedida pela Genix (plan_grants, migration 38); expiresAt null = vitalícia */
  grant: { kind: "profissional" | "equipe"; expiresAt: string | null } | null;
  /** fim dos 6 meses do Grátis (subscriptions.free_ends_at, migration 52); null = sem data */
  freeEndsAt: string | null;
  /** dias restantes do Grátis (só no Grátis, enquanto vale) */
  freeDaysLeft: number | null;
  /** Grátis vencido: a vitrine não aceita agendamento online */
  freeOver: boolean;
};

/** Recursos de equipe (acessos individuais, comissões, salão-parceiro) */
export const hasTeamFeatures = (plan: Pick<PlanContext, "kind">) => plan.kind === "equipe";

const daysUntil = (iso: string | null | undefined) => {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  return ms > 0 ? Math.ceil(ms / 86_400_000) : null;
};

export const getPlanContext = cache(async (businessId: string): Promise<PlanContext> => {
  const supabase = createClient();

  const [{ data: tier }, { data: kind, error: kindError }, subRes, { data: g }] = await Promise.all([
    supabase.rpc("access_tier", { bid: businessId }),
    supabase.rpc("plan_kind", { bid: businessId }),
    supabase
      .from("subscriptions")
      .select("status, plan_id, trial_ends_at, current_period_end, free_ends_at")
      .eq("business_id", businessId)
      .maybeSingle(),
    // sem a tabela (migration 38 ainda não aplicada) vem erro → sem cortesia
    supabase.from("plan_grants").select("kind, expires_at").eq("business_id", businessId).maybeSingle(),
  ]);

  // sem a coluna free_ends_at (migration 52a ainda não aplicada): lê sem ela
  let sub = subRes.data as {
    status: string; plan_id: string | null; trial_ends_at: string | null;
    current_period_end: string | null; free_ends_at?: string | null;
  } | null;
  if (subRes.error) {
    const { data } = await supabase
      .from("subscriptions")
      .select("status, plan_id, trial_ends_at, current_period_end")
      .eq("business_id", businessId)
      .maybeSingle();
    sub = data;
  }

  const grantActive = !!g && (g.kind === "profissional" || g.kind === "equipe") &&
    (!g.expires_at || new Date(g.expires_at).getTime() > Date.now());
  const grant: PlanContext["grant"] = grantActive
    ? { kind: g.kind as "profissional" | "equipe", expiresAt: g.expires_at ?? null }
    : null;

  const trialDaysLeft = sub?.status === "trialing" ? daysUntil(sub.trial_ends_at) : null;

  const t = tier === "gratis" ? "gratis" : "completo";
  // sem a função plan_kind (migration 28a ainda não aplicada): pago = Equipe
  const k: PlanKind = !kindError && (kind === "gratis" || kind === "basico" || kind === "profissional" || kind === "equipe")
    ? kind
    : t === "gratis" ? "gratis" : "equipe";

  const freeEndsAt = sub?.free_ends_at ?? null;
  const freeOver = t === "gratis" && !!freeEndsAt && new Date(freeEndsAt).getTime() <= Date.now();

  return {
    tier: t,
    kind: k,
    status: (sub?.status as PlanContext["status"]) ?? null,
    planId: sub?.plan_id ?? null,
    trialEndsAt: sub?.trial_ends_at ?? null,
    currentPeriodEnd: sub?.current_period_end ?? null,
    trialDaysLeft,
    internal: !sub || !!grant,
    grant,
    freeEndsAt,
    freeDaysLeft: t === "gratis" && !freeOver ? daysUntil(freeEndsAt) : null,
    freeOver,
  };
});

/** Atalho: o plano do espaço chega ao mínimo? */
export const allows = (plan: Pick<PlanContext, "kind">, min: Exclude<PlanKind, "gratis">) => planAllows(plan.kind, min);

/** Plano recomendado no fim do teste: 1 profissional ativo → Profissional; 2+ → Equipe */
export const recommendedKind = (activeProfessionals: number): "profissional" | "equipe" =>
  activeProfessionals <= 1 ? "profissional" : "equipe";
