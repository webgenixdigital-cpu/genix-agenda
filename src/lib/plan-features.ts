// Recursos dos planos pagos (usado no servidor e no navegador)
// minPlan: plano mínimo que libera o recurso (aparece no cadeado).

export const FREE_LOCKED_HREFS = ["/admin/bloqueios", "/admin/financeiro"];

export type LockedFeatureKey = "bloqueios" | "retornos" | "financeiro" | "faturamento" | "pacotes";

export const LOCKED_FEATURES: Record<
  LockedFeatureKey,
  { title: string; description: string; bullets: string[]; minPlan: "profissional" | "equipe" }
> = {
  bloqueios: {
    title: "Bloqueios de agenda",
    description: "Tire férias, folgas e feriados da agenda sem precisar recusar cliente por mensagem.",
    bullets: [
      "Bloqueie um dia, um período ou só algumas horas",
      "Folgas fixas toda semana, sem cadastrar dia por dia",
      "Aviso de quem já estava marcado no período",
    ],
    minPlan: "profissional",
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
    minPlan: "profissional",
  },
  faturamento: {
    title: "Faturamento e relatório para o contador",
    description: "Acompanhe o limite do MEI, do nanoempreendedor ou do Simples e entregue ao contador um resumo pronto.",
    bullets: [
      "Receita do mês, do ano e dos últimos 12 meses",
      "Alertas ao chegar perto do limite",
      "Relatório para imprimir em PDF ou baixar em planilha",
    ],
    minPlan: "profissional",
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
};

/** Texto do cadeado: "planos Profissional e Equipe" ou "plano Equipe" */
export const minPlanLabel = (minPlan: "profissional" | "equipe") =>
  minPlan === "equipe" ? "plano Equipe" : "planos Profissional e Equipe";
