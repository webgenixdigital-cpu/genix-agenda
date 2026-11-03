// Tipos e regras da Agenda usados no servidor e no cliente (sem Supabase aqui)
import type { AgendaBooking } from "@/components/admin/agenda/booking-actions";
import { addDaysISO } from "@/lib/dates";

export type AgendaItem = AgendaBooking & { customer_id: string | null };

export type AgendaBlock = {
  professional_id: string | null;
  date_start: string;
  date_end: string;
  time_start: string | null;
  time_end: string | null;
  reason: string | null;
  recurring: boolean;
  weekdays: number[] | null;
};

export type AgendaHour = { weekday: number; open_time: string | null; close_time: string | null; closed: boolean };

/** Bloqueio vale neste dia? (recorrentes só nos dias da semana marcados) */
export function blockAppliesOn(k: AgendaBlock, day: string) {
  if (day < k.date_start || day > k.date_end) return false;
  const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
  return !k.recurring || (k.weekdays ?? []).includes(weekday);
}

/** "2026-11" a partir de "2026-11" ou "2026-11-04"; senão null */
export function monthOf(value: string | undefined) {
  return /^\d{4}-\d{2}(-\d{2})?$/.test(value ?? "") ? value!.slice(0, 7) : null;
}

/** "2026-11" + n meses */
export function addMonths(month: string, n: number) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

/** Grade do mês: da segunda da 1ª semana ao domingo da última (5 ou 6 semanas) */
export function monthRange(month: string) {
  const first = `${month}-01`;
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  const weekday = new Date(`${first}T12:00:00Z`).getUTCDay();
  const from = addDaysISO(first, -((weekday + 6) % 7));
  const lastWeekday = new Date(`${last}T12:00:00Z`).getUTCDay();
  const to = addDaysISO(last, (7 - lastWeekday) % 7);
  return { from, to };
}

/** "novembro de 2026" */
export function monthTitle(month: string) {
  const [y, m] = month.split("-").map(Number);
  return new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" }).format(Date.UTC(y, m - 1, 15));
}
