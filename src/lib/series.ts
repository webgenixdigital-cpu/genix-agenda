// Rótulos da recorrência (usados no servidor e no navegador)
export const FREQUENCY_LABEL = {
  weekly: "Toda semana",
  biweekly: "A cada 15 dias",
  monthly: "Todo mês",
} as const;

/** Motivos devolvidos por booking_slot_issue / create_booking_series (20_recorrencia.sql) */
export const SKIP_REASON: Record<string, string> = {
  PASSADO: "data já passou",
  FECHADO: "espaço fechado",
  FORA_EXPEDIENTE: "fora do expediente",
  PROFISSIONAL_INDISPONIVEL: "profissional indisponível",
  BLOQUEIO: "agenda bloqueada",
  OCUPADO: "horário ocupado",
  PACOTE_SEM_SALDO: "pacote sem saldo",
  PACOTE_VENCIDO: "pacote vencido",
  PACOTE_INVALIDO: "pacote inválido",
  RECUSADO: "recusado pelo sistema",
};
