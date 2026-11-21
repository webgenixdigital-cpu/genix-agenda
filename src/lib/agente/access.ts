// Quem vê a Nix (assistente) e em que modo. Só servidor (lê variáveis de ambiente).
// A mesma regra está no banco (agent_access / ai_usage_hit, migration 60): a rota sempre confere lá.
import type { AdminContext } from "@/lib/admin";
import { hasTeamFeatures, type PlanContext } from "@/lib/plan";

export type AgentAccess =
  /** sem botão: Nix desligada, sem chave, papel sem acesso ou demonstração */
  | { kind: "oculto" }
  /** botão com cadeado: “A Nix está disponível no plano Equipe” (não chama a API) */
  | { kind: "bloqueado" }
  /** últimos 3 dias do teste de 15 dias, com cota diária */
  | { kind: "teste"; trialEndsAt: string }
  /** Equipe pago (assinatura, cortesia ou antigo Completo) */
  | { kind: "pago" };

/** Nix ligada no servidor? (AGENTE_ENABLED=1 e chave do Gemini) */
export const agentEnabled = () => process.env.AGENTE_ENABLED === "1" && !!process.env.GEMINI_API_KEY;

/** Dias finais do teste em que a Nix fica liberada */
export const TRIAL_WINDOW_DAYS = 3;

export function agentAccess(ctx: Pick<AdminContext, "role" | "business">, plan: PlanContext): AgentAccess {
  if (!agentEnabled()) return { kind: "oculto" };
  if (ctx.role !== "owner" && ctx.role !== "reception") return { kind: "oculto" };
  if (ctx.business.is_demo) return { kind: "oculto" };

  // Mesma ordem do agent_access (60). NÃO basta plan.kind === "equipe": conta sem assinatura também cai lá.
  // 1) cortesia: Equipe libera; cortesia de outro plano não
  if (plan.grant) return plan.grant.kind === "equipe" ? { kind: "pago" } : { kind: "bloqueado" };
  // 2) conta sem assinatura = bloqueada (a cortesia já saiu acima; contas de teste recebem cortesia Equipe)
  if (plan.internal) return { kind: "bloqueado" };
  // 3) teste valendo: só nos 3 últimos dias (trialDaysLeft arredonda para cima: 3, 2 e 1)
  if (plan.status === "trialing" && plan.trialDaysLeft !== null && plan.trialDaysLeft > 0) {
    return plan.trialDaysLeft <= TRIAL_WINDOW_DAYS && plan.trialEndsAt
      ? { kind: "teste", trialEndsAt: plan.trialEndsAt }
      : { kind: "bloqueado" };
  }
  // 4) assinatura Equipe (ou antigo Completo) paga ou em atraso, enquanto o sistema ainda trata como Equipe
  if ((plan.status === "active" || plan.status === "past_due") && hasTeamFeatures(plan)) return { kind: "pago" };
  return { kind: "bloqueado" };
}
