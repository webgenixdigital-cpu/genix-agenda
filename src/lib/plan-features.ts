// Recursos exclusivos do plano Completo (usado no servidor e no navegador)

export const FREE_LOCKED_HREFS = ["/admin/bloqueios", "/admin/lembretes", "/admin/financeiro"];

export type LockedFeatureKey = "bloqueios" | "lembretes" | "financeiro";

export const LOCKED_FEATURES: Record<
  LockedFeatureKey,
  { title: string; description: string; bullets: string[] }
> = {
  bloqueios: {
    title: "Bloqueios de agenda",
    description: "Tire férias, folgas e feriados da agenda sem precisar recusar cliente por mensagem.",
    bullets: [
      "Bloqueie um dia, um período ou só algumas horas",
      "Folgas fixas toda semana, sem cadastrar dia por dia",
      "Aviso automático de quem já estava marcado no período",
    ],
  },
  lembretes: {
    title: "Lembretes de véspera",
    description: "Lembre todos os clientes de amanhã em poucos toques e reduza as faltas.",
    bullets: [
      "Fila com os clientes do dia seguinte",
      "Mensagem pronta no WhatsApp com um toque",
      "Controle de quem já foi lembrado",
    ],
  },
  financeiro: {
    title: "Financeiro e caixa",
    description: "Saiba quanto entrou, quanto saiu e de onde vem o seu faturamento.",
    bullets: [
      "Atendimentos concluídos entram no caixa automaticamente",
      "Gráfico dos últimos 6 meses",
      "Entradas por Pix, cartão e dinheiro",
    ],
  },
};
