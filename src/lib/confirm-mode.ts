// Confirmação automática dos agendamentos online (usado no servidor e no navegador)
// A decisão do status acontece no banco (create_public_booking, 25_confirmacao_automatica).

export type ConfirmMode = "todos" | "recorrentes" | "manual";
export type AutoConfirmReason = "todos" | "cliente_recorrente";

export const CONFIRM_MODES: { value: ConfirmMode; label: string; help: string }[] = [
  {
    value: "todos",
    label: "Tudo automático",
    help: "Todo agendamento feito na vitrine já entra confirmado.",
  },
  {
    value: "recorrentes",
    label: "Só clientes recorrentes",
    help: "Confirma sozinho quem já foi atendido aqui. Cliente novo fica aguardando sua confirmação.",
  },
  {
    value: "manual",
    label: "Tudo manual",
    help: "Você confirma cada pedido da vitrine.",
  },
];

export const isConfirmMode = (v: string): v is ConfirmMode => CONFIRM_MODES.some((m) => m.value === v);

export const AUTO_CONFIRM_LABEL: Record<AutoConfirmReason, string> = {
  cliente_recorrente: "Confirmado automaticamente: cliente recorrente",
  todos: "Confirmado automaticamente: confirmação automática ativa",
};

/** Motivo em texto curto (histórico) */
export const AUTO_CONFIRM_REASON: Record<AutoConfirmReason, string> = {
  cliente_recorrente: "cliente recorrente",
  todos: "confirmação automática ativa",
};
