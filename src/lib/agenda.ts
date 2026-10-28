// Tipos e regras da Agenda usados no servidor e no cliente (sem Supabase aqui)
import type { AgendaBooking } from "@/components/admin/agenda/booking-actions";

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
