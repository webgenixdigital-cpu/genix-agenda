// Metas (migration 58): tipos, rótulos e ritmo até o fim do período.
// Lógica pura (servidor e navegador). Classes Tailwind ficam em src/components/admin/metas.

import { addDaysISO } from "@/lib/dates";

export type GoalKind = "faturamento" | "atendimentos" | "ticket_medio" | "clientes_novos";

export const GOAL_KINDS: GoalKind[] = ["faturamento", "atendimentos", "ticket_medio", "clientes_novos"];

export const GOAL_LABEL: Record<GoalKind, string> = {
  faturamento: "Faturamento",
  atendimentos: "Atendimentos",
  ticket_medio: "Ticket médio",
  clientes_novos: "Clientes novos",
};

/** Valor em R$ (faturamento, ticket médio) ou quantidade (atendimentos, clientes novos) */
export const isMoneyGoal = (kind: GoalKind) => kind === "faturamento" || kind === "ticket_medio";

/** Linha de goals_with_progress */
export type GoalWithProgress = {
  id: string;
  kind: GoalKind;
  target: number;
  period_start: string;
  period_end: string;
  professional_id: string | null;
  professional_name: string | null;
  realized: number;
  base_count: number;
};

export type GoalStatus = "futura" | "concluida" | "no_ritmo" | "abaixo" | "encerrada";

export type GoalPace = {
  status: GoalStatus;
  /** 0 a 100 (pode passar de 100 quando a meta foi superada) */
  pct: number;
  /** quanto falta para a meta (0 quando atingida) */
  missing: number;
  /** dias que faltam, contando hoje (só enquanto a meta está em andamento) */
  daysLeft: number;
  /** quanto precisa por dia até o fim (faturamento, atendimentos, clientes novos) */
  perDay: number | null;
};

/** Dias corridos entre duas datas "yyyy-mm-dd", contando as duas pontas */
export function daysBetween(fromISO: string, toISO: string) {
  const a = Date.parse(`${fromISO}T12:00:00Z`);
  const b = Date.parse(`${toISO}T12:00:00Z`);
  return Math.round((b - a) / 86_400_000) + 1;
}

/**
 * Ritmo da meta em dias corridos (o dia de hoje conta como dia que falta).
 * Ticket médio é uma média: não tem "por dia", só atingido ou não.
 */
export function goalPace(g: GoalWithProgress, today: string): GoalPace {
  const target = Number(g.target);
  const realized = Number(g.realized);
  const pct = target > 0 ? Math.round((realized / target) * 100) : 0;
  const missing = Math.max(target - realized, 0);
  const reached = realized >= target;

  if (today < g.period_start) {
    return { status: "futura", pct, missing, daysLeft: daysBetween(g.period_start, g.period_end), perDay: null };
  }
  if (today > g.period_end) {
    return { status: reached ? "concluida" : "encerrada", pct, missing, daysLeft: 0, perDay: null };
  }

  const daysLeft = daysBetween(today, g.period_end);
  if (reached) return { status: "concluida", pct, missing: 0, daysLeft, perDay: null };

  let onPace: boolean;
  let perDay: number | null = null;
  if (g.kind === "ticket_medio") {
    onPace = false;
  } else {
    const total = daysBetween(g.period_start, g.period_end);
    const elapsed = total - daysLeft; // dias já passados, sem contar hoje
    onPace = realized >= (target * elapsed) / total;
    perDay = missing / daysLeft;
  }
  return { status: onPace ? "no_ritmo" : "abaixo", pct, missing, daysLeft, perDay };
}

/** Primeiro e último dia do mês de uma data (+ n meses) */
export function monthRange(todayISO: string, plusMonths = 0) {
  const [y, m] = todayISO.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1 + plusMonths, 1, 12));
  const start = first.toISOString().slice(0, 10);
  const next = new Date(Date.UTC(y, m + plusMonths, 1, 12)).toISOString().slice(0, 10);
  return { start, end: addDaysISO(next, -1) };
}
