// Planos e recursos (usado no servidor e no navegador).
// Ordem: Grátis < Básico < Profissional < Equipe (igual a plan_rank/plan_allows no banco, migration 52).
// minPlan: plano mínimo que libera o recurso (aparece no cadeado).

export type PlanKind = "gratis" | "basico" | "profissional" | "equipe";
export type MinPlan = Exclude<PlanKind, "gratis">;

export const PLAN_NAMES: Record<PlanKind, string> = {
  gratis: "Grátis",
  basico: "Básico",
  profissional: "Profissional",
  equipe: "Equipe",
};

const RANK: Record<PlanKind, number> = { gratis: 0, basico: 1, profissional: 2, equipe: 3 };

/** O plano chega ao mínimo? (mesma regra de plan_allows no banco) */
export const planAllows = (kind: PlanKind, min: MinPlan) => RANK[kind] >= RANK[min];

/** Itens do menu com cadeado, conforme o plano */
export function lockedHrefsFor(kind: PlanKind): string[] {
  if (!planAllows(kind, "basico")) return ["/admin/bloqueios", "/admin/financeiro", "/admin/lembretes"];
  return [];
}

export type LockedFeatureKey =
  | "bloqueios"
  | "retornos"
  | "lembretes"
  | "financeiro"
  | "faturamento"
  | "pacotes"
  | "combos"
  | "encaixe"
  | "recorrencia";

export const LOCKED_FEATURES: Record<
  LockedFeatureKey,
  { title: string; description: string; bullets: string[]; minPlan: MinPlan }
> = {
  bloqueios: {
    title: "Bloqueios de agenda",
    description: "Marque almoço, folgas, férias e feriados sem precisar recusar cliente por mensagem.",
    bullets: [
      "Bloqueie um dia, um período ou só algumas horas",
      "Almoço e folgas fixas toda semana, sem cadastrar dia por dia",
      "Aviso de quem já estava marcado no período",
    ],
    minPlan: "basico",
  },
  lembretes: {
    title: "Lembretes de véspera",
    description: "Lembre os clientes de amanhã e de hoje com a mensagem pronta no WhatsApp, em um toque.",
    bullets: [
      "Fila de quem tem horário amanhã e hoje",
      "Mensagem pronta com nome, serviço e horário",
      "Marque quem já foi lembrado",
    ],
    minPlan: "basico",
  },
  retornos: {
    title: "Retornos",
    description: "Saiba quem está na hora de voltar e chame o cliente com a mensagem pronta.",
    bullets: [
      "Prazo de retorno por serviço",
      "Fila “hora de voltar” com os clientes do período",
      "Mensagem pronta no WhatsApp com um toque",
    ],
    minPlan: "profissional",
  },
  financeiro: {
    title: "Financeiro e caixa",
    description: "Saiba quanto entrou, quanto saiu e de onde vem o seu faturamento.",
    bullets: [
      "Atendimentos concluídos entram no caixa automaticamente",
      "Gráfico dos últimos 6 meses",
      "Entradas por Pix, cartão e dinheiro",
    ],
    minPlan: "basico",
  },
  faturamento: {
    title: "Faturamento e relatório para o contador",
    description: "Acompanhe o limite do MEI, do nanoempreendedor ou do Simples e entregue ao contador um resumo pronto.",
    bullets: [
      "Receita do mês, do ano e dos últimos 12 meses",
      "Alertas ao chegar perto do limite",
      "Relatório para imprimir em PDF ou baixar em planilha",
    ],
    minPlan: "basico",
  },
  pacotes: {
    title: "Pacotes de sessões",
    description: "Venda pacotes como “10 drenagens” e acompanhe o saldo de cada cliente sem caderno.",
    bullets: [
      "Modelos de pacote com preço e validade",
      "Saldo de sessões na ficha do cliente",
      "Venda lançada no caixa uma vez só",
    ],
    minPlan: "profissional",
  },
  combos: {
    title: "Combos de serviços",
    description: "Junte serviços como “Corte + Barba” com um preço especial e mostre a economia na vitrine.",
    bullets: [
      "De 2 a 6 serviços com preço especial",
      "Vitrine mostra “de R$ X por R$ Y”",
      "Agendado como um serviço só, com a duração somada",
    ],
    minPlan: "profissional",
  },
  encaixe: {
    title: "Encaixe",
    description: "Marque um horário fora da lista ou por cima de outro atendimento, quando o tempo de produto permite.",
    bullets: [
      "Horário fora do expediente ou da grade",
      "Encaixe sobreposto durante a pausa de outro atendimento",
      "Bloqueios e conflitos continuam valendo",
    ],
    minPlan: "basico",
  },
  recorrencia: {
    title: "Agendamentos recorrentes",
    description: "Repita o mesmo horário toda semana, a cada 15 dias ou todo mês, de uma vez só.",
    bullets: [
      "Semanal, quinzenal ou mensal",
      "Aviso das datas que já estão ocupadas",
      "Cancele uma data ou a série inteira",
    ],
    minPlan: "basico",
  },
};

/** Texto do cadeado: "a partir do Básico", "planos Profissional e Equipe" ou "plano Equipe" */
export const minPlanLabel = (minPlan: MinPlan) =>
  minPlan === "equipe" ? "plano Equipe" : minPlan === "profissional" ? "planos Profissional e Equipe" : "planos pagos, a partir do Básico";

/** Mensagens dos erros de plano que vêm do banco (PLANO_BASICO, PLANO_PROFISSIONAL...) */
export const PLAN_ERRORS = {
  PLANO_BASICO: "Recurso dos planos pagos, a partir do Básico. Veja em Assinatura.",
  PLANO_PROFISSIONAL: "Recurso dos planos Profissional e Equipe. Veja em Assinatura.",
  PLANO_EQUIPE: "Recurso do plano Equipe. Veja em Assinatura.",
} as const;
