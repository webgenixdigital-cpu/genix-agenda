// Planos e recursos (usado no servidor e no navegador).
// Ordem: Grátis < Básico < Profissional < Equipe (igual a plan_rank/plan_allows no banco, migration 52).
// Plano mínimo de cada recurso: src/content/planos.ts (FEATURES, fonte única, migration 59).
import { FEATURES, PLAN_NAMES, PLAN_RANK, scopeLabel, type FeatureKey, type MinPlan, type PlanKind } from "@/content/planos";

export { PLAN_NAMES, type MinPlan, type PlanKind };

/** O plano chega ao mínimo? (mesma regra de plan_allows no banco) */
export const planAllows = (kind: PlanKind, min: MinPlan) => PLAN_RANK[kind] >= PLAN_RANK[min];

/** Plano mínimo de um recurso pago (para o cadeado) */
const minOf = (key: FeatureKey) => FEATURES[key].min as MinPlan;

/** Itens do menu com cadeado, conforme o plano */
export function lockedHrefsFor(kind: PlanKind): string[] {
  const menu: [string, FeatureKey][] = [
    ["/admin/bloqueios", "bloqueios"],
    ["/admin/financeiro", "financeiro"],
    ["/admin/lembretes", "lembretes"],
    ["/admin/metas", "metas"],
  ];
  return menu.filter(([, key]) => !planAllows(kind, minOf(key))).map(([href]) => href);
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
  | "recorrencia"
  | "metas"
  | "vitrine"
  | "nix";

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
    minPlan: minOf("bloqueios"),
  },
  lembretes: {
    title: "Lembretes de véspera",
    description: "Lembre os clientes de amanhã e de hoje com a mensagem pronta no WhatsApp, em um toque.",
    bullets: [
      "Fila de quem tem horário amanhã e hoje",
      "Mensagem pronta com nome, serviço e horário",
      "Marque quem já foi lembrado",
    ],
    minPlan: minOf("lembretes"),
  },
  retornos: {
    title: "Retornos",
    description: "Saiba quem está na hora de voltar e chame o cliente com a mensagem pronta.",
    bullets: [
      "Prazo de retorno por serviço",
      "Fila “hora de voltar” com os clientes do período",
      "Mensagem pronta no WhatsApp com um toque",
    ],
    minPlan: minOf("retornos"),
  },
  financeiro: {
    title: "Financeiro e caixa",
    description: "Saiba quanto entrou, quanto saiu e de onde vem o seu faturamento.",
    bullets: [
      "Atendimentos concluídos entram no caixa automaticamente",
      "Gráfico dos últimos 6 meses",
      "Entradas por Pix, cartão e dinheiro",
    ],
    minPlan: minOf("financeiro"),
  },
  faturamento: {
    title: "Faturamento e relatório para o contador",
    description: "Acompanhe o limite do MEI, do nanoempreendedor ou do Simples e entregue ao contador um resumo pronto.",
    bullets: [
      "Receita do mês, do ano e dos últimos 12 meses",
      "Alertas ao chegar perto do limite",
      "Relatório para imprimir em PDF ou baixar em planilha",
    ],
    minPlan: minOf("faturamento"),
  },
  pacotes: {
    title: "Pacotes de sessões",
    description: "Venda pacotes como “10 drenagens” e acompanhe o saldo de cada cliente sem caderno.",
    bullets: [
      "Modelos de pacote com preço e validade",
      "Saldo de sessões na ficha do cliente",
      "Venda lançada no caixa uma vez só",
    ],
    minPlan: minOf("pacotes"),
  },
  combos: {
    title: "Combos de serviços",
    description: "Junte serviços como “Corte + Barba” com um preço especial e mostre a economia na vitrine.",
    bullets: [
      "De 2 a 6 serviços com preço especial",
      "Vitrine mostra “de R$ X por R$ Y”",
      "Agendado como um serviço só, com a duração somada",
    ],
    minPlan: minOf("combos"),
  },
  encaixe: {
    title: "Encaixe",
    description: "Marque um horário fora da lista ou por cima de outro atendimento, quando o tempo de produto permite.",
    bullets: [
      "Horário fora do expediente ou da grade",
      "Encaixe sobreposto durante a pausa de outro atendimento",
      "Bloqueios e conflitos continuam valendo",
    ],
    minPlan: minOf("encaixe"),
  },
  recorrencia: {
    title: "Agendamentos recorrentes",
    description: "Repita o mesmo horário toda semana, a cada 15 dias ou todo mês, de uma vez só.",
    bullets: [
      "Semanal, quinzenal ou mensal",
      "Aviso das datas que já estão ocupadas",
      "Cancele uma data ou a série inteira",
    ],
    minPlan: minOf("recorrencia"),
  },
  metas: {
    title: "Metas",
    description: "Defina metas de faturamento, atendimentos, ticket médio e clientes novos e veja quanto falta por dia.",
    bullets: [
      "Progresso de cada meta, atualizado com o caixa e a agenda",
      "Quanto falta e quanto precisa por dia até o fim do período",
      "No plano Equipe, metas por profissional",
    ],
    minPlan: minOf("metas"),
  },
  vitrine: {
    title: "Vitrine com agendamento online",
    description: "O cliente vê os horários livres e agenda sozinho, a qualquer hora, sem você precisar responder mensagem.",
    bullets: [
      "Só os horários livres de verdade, 24 horas",
      "Confirmação automática dos agendamentos online",
      "Seu espaço no diretório de espaços do Genix Agenda",
    ],
    minPlan: minOf("vitrine"),
  },
  nix: {
    title: "Nix, sua assistente",
    description: "Tire dúvidas do sistema conversando, a qualquer hora, sem procurar em menus.",
    bullets: [
      "Passo a passo de qualquer tela do Genix Agenda",
      "Explica planos e recursos do jeito do seu espaço",
      "Em breve: resumo do dia e ajuda com a agenda e o caixa",
    ],
    minPlan: minOf("nix"),
  },
};

/** Texto do cadeado: "a partir do Básico", "planos Profissional e Equipe" ou "plano Equipe" */
export const minPlanLabel = scopeLabel;

/** Mensagens dos erros de plano que vêm do banco (PLANO_BASICO, PLANO_PROFISSIONAL...) */
export const PLAN_ERRORS = {
  PLANO_BASICO: "Recurso dos planos pagos, a partir do Básico. Veja em Assinatura.",
  PLANO_PROFISSIONAL: "Recurso dos planos Profissional e Equipe. Veja em Assinatura.",
  PLANO_EQUIPE: "Recurso do plano Equipe. Veja em Assinatura.",
  /** 59: Grátis vencido = painel só consulta */
  PLANO_CONSULTA: "Seu Grátis terminou e o painel está só para consulta. Assine o Básico para continuar agendando.",
} as const;
