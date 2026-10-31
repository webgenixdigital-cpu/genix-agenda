// Ids dos planos pagos (tabela plans, migration 28a). Usado no servidor e no navegador.
// Planos antigos 'mensal'/'anual' (Completo) contam como Equipe, com o valor contratado.

export type PaidKind = "profissional" | "equipe";
export type Cycle = "mensal" | "anual";

export const PAID_PLAN_IDS = ["profissional_mensal", "profissional_anual", "equipe_mensal", "equipe_anual"] as const;
export type PaidPlanId = (typeof PAID_PLAN_IDS)[number];

export const isPaidPlanId = (id: string): id is PaidPlanId => (PAID_PLAN_IDS as readonly string[]).includes(id);
export const planIdFor = (kind: PaidKind, cycle: Cycle) => `${kind}_${cycle}` as PaidPlanId;
export const kindOfPlanId = (id: string | null | undefined): PaidKind => (id?.startsWith("profissional") ? "profissional" : "equipe");
export const cycleOfPlanId = (id: string | null | undefined): Cycle => (id?.endsWith("anual") ? "anual" : "mensal");
/** contrato do antigo plano Completo (valor mantido) */
export const isLegacyPlanId = (id: string | null | undefined) => id === "mensal" || id === "anual";
