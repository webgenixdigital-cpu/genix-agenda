"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getEditorContext } from "@/lib/admin";

export type AffectedBooking = {
  id: string;
  booking_date: string;
  start_time: string;
  customer_name: string;
  customer_phone: string;
  service_name: string;
  professional_name: string;
};

export type BlockInput = {
  professionalId: string | null;   // null = equipe toda
  dateStart: string;               // YYYY-MM-DD
  dateEnd: string;
  timeStart: string | null;        // null = dia inteiro
  timeEnd: string | null;
  reason: string;
  recurring: boolean;
  weekdays: number[];              // 0 = domingo ... 6 = sábado
};

type CreateResult =
  | { ok: true; affected: AffectedBooking[] }
  | { ok: false; error: string };

function refresh() {
  revalidatePath("/admin/bloqueios");
  revalidatePath("/admin/agenda");
}

// ---------------------------------------------------------------------
// PARTE 1 — Criar bloqueio + listar clientes afetados
// ---------------------------------------------------------------------
export async function createBlock(input: BlockInput): Promise<CreateResult> {
  const { business } = await getEditorContext();
  const supabase = createClient();

  if (!input.dateStart || !input.dateEnd || input.dateEnd < input.dateStart) {
    return { ok: false, error: "Escolha o período do bloqueio." };
  }
  if ((input.timeStart && !input.timeEnd) || (!input.timeStart && input.timeEnd)) {
    return { ok: false, error: "Informe o horário de início e de fim." };
  }
  if (input.timeStart && input.timeEnd && input.timeEnd <= input.timeStart) {
    return { ok: false, error: "O horário final precisa ser depois do inicial." };
  }
  if (input.recurring && input.weekdays.length === 0) {
    return { ok: false, error: "Escolha pelo menos um dia da semana." };
  }

  const { error } = await supabase.from("schedule_blocks").insert({
    business_id: business.id,
    professional_id: input.professionalId,
    date_start: input.dateStart,
    date_end: input.dateEnd,
    time_start: input.timeStart,
    time_end: input.timeEnd,
    reason: input.reason.trim() || null,
    recurring: input.recurring,
    weekdays: input.recurring ? input.weekdays : [],
  });
  if (error) return { ok: false, error: "Não foi possível salvar o bloqueio." };

  // agendamentos ativos que caem dentro do bloqueio
  let q = supabase
    .from("bookings")
    .select("id, booking_date, start_time, end_time, customer_name, customer_phone, service_name, professional_name, professional_id")
    .eq("business_id", business.id)
    .in("status", ["pending", "confirmed"])
    .gte("booking_date", input.dateStart)
    .lte("booking_date", input.dateEnd)
    .order("booking_date")
    .order("start_time");
  if (input.professionalId) q = q.eq("professional_id", input.professionalId);
  const { data } = await q;

  const affected = (data ?? []).filter((b) => {
    const dow = new Date(`${b.booking_date}T12:00:00`).getDay();
    if (input.recurring && !input.weekdays.includes(dow)) return false;
    if (!input.timeStart) return true;
    return b.start_time < `${input.timeEnd}:00` && b.end_time > `${input.timeStart}:00`;
  });

  refresh();
  return { ok: true, affected };
}

// ---------------------------------------------------------------------
// PARTE 2 — Remover bloqueio
// ---------------------------------------------------------------------
export async function deleteBlock(id: string): Promise<{ ok: boolean; error?: string }> {
  const { business } = await getEditorContext();
  const supabase = createClient();
  const { error } = await supabase.from("schedule_blocks").delete().eq("id", id).eq("business_id", business.id);
  if (error) return { ok: false, error: "Não foi possível remover o bloqueio." };
  refresh();
  return { ok: true };
}