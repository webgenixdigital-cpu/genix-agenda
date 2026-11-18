// Ids dos planos pagos (tabela plans, migrations 28a e 51). Usado no servidor e no navegador.
// Planos antigos 'mensal'/'anual' (Completo) contam como Equipe, com o valor contratado.

export type PaidKind = "basico" | "profissional" | "equipe";
export type Cycle = "mensal" | "anual";

/** ordem dos planos pagos, do menor para o maior */
export const PAID_KINDS: readonly PaidKind[] = ["basico", "profissional", "equipe"];

export const PAID_PLAN_IDS = [
  "basico_mensal",
  "basico_anual",
  "profissional_mensal",
  "profissional_anual",
  "equipe_mensal",
  "equipe_anual",
] as const;
export type PaidPlanId = (typeof PAID_PLAN_IDS)[number];

export const isPaidPlanId = (id: string): id is PaidPlanId => (PAID_PLAN_IDS as readonly string[]).includes(id);
export const planIdFor = (kind: PaidKind, cycle: Cycle) => `${kind}_${cycle}` as PaidPlanId;
export const kindOfPlanId = (id: string | null | undefined): PaidKind =>
  id?.startsWith("basico") ? "basico" : id?.startsWith("profissional") ? "profissional" : "equipe";
export const cycleOfPlanId = (id: string | null | undefined): Cycle => (id?.endsWith("anual") ? "anual" : "mensal");
/** contrato do antigo plano Completo (valor mantido) */
export const isLegacyPlanId = (id: string | null | undefined) => id === "mensal" || id === "anual";
/** posição do plano pago (para saber se a troca é upgrade ou downgrade) */
export const paidRank = (kind: PaidKind) => PAID_KINDS.indexOf(kind);
/** planos de 1 profissional (sem extra nem acessos de equipe) */
export const isSoloKind = (kind: PaidKind) => kind !== "equipe";
