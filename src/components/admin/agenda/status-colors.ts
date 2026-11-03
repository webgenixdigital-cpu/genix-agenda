// Cores por status da Agenda (Semana e Mês). Fica em components/ para o Tailwind enxergar as classes.
/** Cor do bloco por status (Semana e Mês) */
export const STATUS_STYLE: Record<string, string> = {
  pending: "bg-amber-50 border-amber-300 text-amber-950",
  confirmed: "bg-blue-50 border-blue-300 text-blue-950",
  completed: "bg-green-50 border-green-300 text-green-950",
  cancelled: "bg-red-50 border-red-200 text-red-900 opacity-60 line-through decoration-red-300",
};

/** Bolinha por status (calendário do celular) */
export const STATUS_DOT: Record<string, string> = {
  pending: "bg-amber-500",
  confirmed: "bg-blue-500",
  completed: "bg-green-600",
  cancelled: "bg-red-400",
};
