"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getAdminContext } from "@/lib/admin";

type Result = { ok: true } | { ok: false; error: string };
type Method = "pix" | "dinheiro" | "credito" | "debito";

const OVERLAP = "23P01"; // exclusion_violation (trava no_overlap)

function refresh() {
  revalidatePath("/admin/agenda");
  revalidatePath("/admin");
}

// ---------------------------------------------------------------------
// PARTE 1 — Confirmar / cancelar
// ---------------------------------------------------------------------
export async function updateBookingStatus(id: string, status: "confirmed" | "cancelled"): Promise<Result> {
  const { business } = await getAdminContext();
  const supabase = createClient();

  const { error } = await supabase
    .from("bookings")
    .update({ status })
    .eq("id", id)
    .eq("business_id", business.id);

  if (error) {
    return {
      ok: false,
      error: error.code === OVERLAP
        ? "Esse profissional já tem outro atendimento nesse horário."
        : "Não foi possível atualizar o agendamento.",
    };
  }
  refresh();
  return { ok: true };
}

// ---------------------------------------------------------------------
// PARTE 2 — Concluir (e lançar no caixa)
// ---------------------------------------------------------------------
export async function completeBooking(id: string, method: Method | null): Promise<Result> {
  const { business, userId } = await getAdminContext();
  const supabase = createClient();

  const { data: bk } = await supabase
    .from("bookings")
    .select("id, price, service_name, customer_name, booking_date")
    .eq("id", id)
    .eq("business_id", business.id)
    .maybeSingle();
  if (!bk) return { ok: false, error: "Agendamento não encontrado." };

  const { error } = await supabase.from("bookings").update({ status: "completed" }).eq("id", id);
  if (error) return { ok: false, error: "Não foi possível concluir o atendimento." };

  if (method && Number(bk.price) > 0) {
    const { count } = await supabase
      .from("cash_entries")
      .select("id", { count: "exact", head: true })
      .eq("booking_id", id);

    if (!count) {
      await supabase.from("cash_entries").insert({
        business_id: business.id,
        booking_id: id,
        kind: "income",
        category: "atendimento",
        method,
        description: `${bk.service_name} — ${bk.customer_name}`,
        amount: bk.price,
        entry_date: bk.booking_date,
        created_by: userId,
      });
    }
  }

  refresh();
  revalidatePath("/admin/financeiro");
  return { ok: true };
}

// ---------------------------------------------------------------------
// PARTE 3 — Agendamento manual (balcão / telefone)
// ---------------------------------------------------------------------
export async function createManualBooking(input: {
  serviceId: string;
  professionalId: string;
  date: string;   // YYYY-MM-DD
  time: string;   // HH:MM
  customerName: string;
  customerPhone: string;
  notes?: string;
}): Promise<Result> {
  const { business } = await getAdminContext();
  const supabase = createClient();

  const name = input.customerName.trim();
  const phone = input.customerPhone.replace(/\D/g, "");
  if (name.length < 2) return { ok: false, error: "Informe o nome do cliente." };
  if (phone.length < 10) return { ok: false, error: "Informe o WhatsApp com DDD." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || !/^\d{2}:\d{2}$/.test(input.time)) {
    return { ok: false, error: "Escolha data e horário." };
  }

  const [{ data: service }, { data: pro }] = await Promise.all([
    supabase.from("services").select("id, name, price, duration_min")
      .eq("id", input.serviceId).eq("business_id", business.id).maybeSingle(),
    supabase.from("professionals").select("id, name")
      .eq("id", input.professionalId).eq("business_id", business.id).maybeSingle(),
  ]);
  if (!service || !pro) return { ok: false, error: "Escolha o serviço e o profissional." };

  const [h, m] = input.time.split(":").map(Number);
  const endMin = h * 60 + m + service.duration_min;
  if (endMin > 24 * 60) return { ok: false, error: "O atendimento passaria da meia-noite." };
  const end = `${String(Math.floor(endMin / 60)).padStart(2, "0")}:${String(endMin % 60).padStart(2, "0")}`;

  const { data: blocked } = await supabase.rpc("slot_conflicts_block", {
    p_business: business.id,
    p_professional: pro.id,
    p_date: input.date,
    p_start: input.time,
    p_end: end,
  });
  if (blocked) return { ok: false, error: "Esse horário está bloqueado na agenda desse profissional." };

  const { error } = await supabase.from("bookings").insert({
    business_id: business.id,
    service_id: service.id,
    professional_id: pro.id,
    service_name: service.name,
    price: service.price,
    duration_min: service.duration_min,
    professional_name: pro.name,
    customer_name: name,
    customer_phone: phone,
    customer_notes: input.notes?.trim() || null,
    booking_date: input.date,
    start_time: input.time,
    end_time: end,
    status: "confirmed",
    source: "manual",
  });

  if (error) {
    return {
      ok: false,
      error: error.code === OVERLAP
        ? `${pro.name} já tem atendimento nesse horário.`
        : "Não foi possível salvar o agendamento.",
    };
  }
  refresh();
  return { ok: true };
}