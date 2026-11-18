// =====================================================================
// O QUE CADA PLANO INCLUI — fonte única dos textos (Assinatura, landing, /para).
// Preços NÃO ficam aqui: vêm da tabela plans (migrations 28a/52).
// Sem classes do Tailwind neste arquivo.
// A regra de verdade (o que o banco libera) está em plan_allows (migration 52)
// e em src/lib/plan-features.ts. Mudou um recurso de plano? Mude aqui também.
// =====================================================================
import type { PlanKind } from "@/lib/plan-features";

export const PLAN_ORDER: readonly PlanKind[] = ["gratis", "basico", "profissional", "equipe"];

/** true = inclui; false = não inclui; texto = inclui com esse limite */
export type PlanCell = boolean | string;

export type PlanFeatureRow = { label: string; values: Record<PlanKind, PlanCell> };

/** Duração do Grátis (meses a partir do cadastro) */
export const FREE_MONTHS = 6;

/** Tabela comparativa. limit = agendamentos online por dia no Grátis; included = profissionais no Equipe */
export function planFeatureRows(limit: number, included: number): PlanFeatureRow[] {
  const all = (v: PlanCell = true) => ({ gratis: v, basico: v, profissional: v, equipe: v });
  return [
    { label: "Prazo", values: { gratis: `${FREE_MONTHS} meses`, basico: "Sem prazo", profissional: "Sem prazo", equipe: "Sem prazo" } },
    { label: "Profissionais", values: { gratis: "1", basico: "1", profissional: "1", equipe: `Até ${included} + extra` } },
    { label: "Agendamentos online", values: { gratis: `${limit} por dia`, basico: "Ilimitados", profissional: "Ilimitados", equipe: "Ilimitados" } },
    { label: "Vitrine com link próprio e QR Code", values: all() },
    { label: "Agenda, clientes, ficha e histórico", values: all() },
    { label: "Confirmação automática, remarcar e editar agendamento", values: all() },
    { label: "Avaliações dos clientes", values: all() },
    { label: "Vitrine sem o selo “Feito com Genix Agenda”", values: { gratis: false, basico: true, profissional: true, equipe: true } },
    { label: "Encaixe e encaixe sobreposto", values: { gratis: false, basico: true, profissional: true, equipe: true } },
    { label: "Bloqueios: almoço, folgas, férias e feriados", values: { gratis: false, basico: true, profissional: true, equipe: true } },
    { label: "Lembretes de véspera (fila em um toque)", values: { gratis: false, basico: true, profissional: true, equipe: true } },
    { label: "Agendamentos recorrentes", values: { gratis: false, basico: true, profissional: true, equipe: true } },
    { label: "Financeiro: caixa, faturamento e contador", values: { gratis: false, basico: true, profissional: true, equipe: true } },
    { label: "Retornos (hora de voltar)", values: { gratis: false, basico: false, profissional: true, equipe: true } },
    { label: "Pacotes de sessões e combos", values: { gratis: false, basico: false, profissional: true, equipe: true } },
    { label: "WhatsApp automático (ativação assistida)", values: { gratis: false, basico: false, profissional: true, equipe: true } },
    { label: "Acessos da equipe, comissões e salão-parceiro", values: { gratis: false, basico: false, profissional: false, equipe: true } },
  ];
}

/** Resumo curto de cada plano (cartões de preço) */
export const PLAN_SUMMARY: Record<PlanKind, { tagline: string; items: (limit: number, included: number) => string[] }> = {
  gratis: {
    tagline: `Para começar: ${FREE_MONTHS} meses sem pagar nada.`,
    items: (limit) => [
      `${limit} agendamentos online por dia`,
      "1 profissional",
      "Agenda, clientes e confirmação automática",
      "Remarcar e editar agendamento",
    ],
  },
  basico: {
    tagline: "Agenda sem limite para quem atende sozinho.",
    items: () => [
      "Agendamentos online ilimitados",
      "Encaixe e bloqueios (almoço, folgas, férias)",
      "Lembretes de véspera e recorrência",
      "Financeiro, faturamento e contador",
    ],
  },
  profissional: {
    tagline: "Tudo liberado para quem atende sozinho.",
    items: () => [
      "Tudo do Básico",
      "WhatsApp automático (ativação assistida)",
      "Retornos, pacotes e combos",
      "Para fidelizar e vender mais",
    ],
  },
  equipe: {
    tagline: "Para salões e equipes.",
    items: (_limit, included) => [
      "Tudo do Profissional",
      `Até ${included} profissionais inclusos`,
      "Acessos para recepção e profissionais",
      "Comissões, “Meus ganhos” e salão-parceiro",
    ],
  },
};
