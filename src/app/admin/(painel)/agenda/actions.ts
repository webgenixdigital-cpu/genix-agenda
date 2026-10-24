"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getAdminContext, getEditorContext } from "@/lib/admin";

type Result = { ok: true } | { ok: false; error: string };
type Method = "pix" | "dinheiro" | "credito" | "debito";

const OVERLAP = "23P01"; // exclusion_violation (trava no_overlap)

// erros do trigger trg_validate_package (19_pacotes.sql)
const PACKAGE_ERRORS: Record<string, string> = {
  PACOTE_SEM_SALDO: "Esse pacote não tem mais sessões disponíveis.",
  PACOTE_VENCIDO: "Esse pacote vence antes da data escolhida.",
  PACOTE_INVALIDO: "Esse pacote não pode ser usado aqui (cancelado, de outro cliente ou de outro serviço).",
};
const packageError = (message?: string) =>
  PACKAGE_ERRORS[Object.keys(PACKAGE_ERRORS).find((k) => message?.includes(k)) ?? ""];

function refresh() {
  revalidatePath("/admin/agenda");
  revalidatePath("/admin");
}

// ---------------------------------------------------------------------
// PARTE 1 — Confirmar / cancelar
// ---------------------------------------------------------------------
export async function updateBookingStatus(id: string, status: "confirmed" | "cancelled"): Promise<Result> {
  const { business } = await getEditorContext();
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
        : packageError(error.message) ?? "Não foi possível atualizar o agendamento.",
    };
  }
  refresh();
  return { ok: true };
}

// ---------------------------------------------------------------------
// PARTE 2 — Concluir (e lançar no caixa)
// ---------------------------------------------------------------------
export async function completeBooking(id: string, method: Method | null): Promise<Result> {
  await getEditorContext();
  const supabase = createClient();

  // status + lançamento no caixa juntos, com a permissão conferida no banco
  const { error } = await supabase.rpc("complete_booking", { p_booking: id, p_method: method });
  if (error) {
    return {
      ok: false,
      error: error.message.includes("SEM_PERMISSAO")
        ? "Você não tem permissão para concluir este atendimento."
        : "Não foi possível concluir o atendimento.",
    };
  }

  refresh();
  revalidatePath("/admin/financeiro");
  revalidatePath("/admin/ganhos");
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
  packageId?: string | null;
}): Promise<Result> {
  const { business } = await getEditorContext();
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
    // o banco valida cliente, serviço, validade e saldo (trg_validate_package)
    customer_package_id: input.packageId || null,
  });

  if (error) {
    return {
      ok: false,
      error: error.code === OVERLAP
        ? `${pro.name} já tem atendimento nesse horário.`
        : packageError(error.message) ?? "Não foi possível salvar o agendamento.",
    };
  }
  refresh();
  if (input.packageId) revalidatePath("/admin/clientes");
  return { ok: true };
}

// ---------------------------------------------------------------------
// PARTE 4 — Pacotes ativos do cliente (pelo WhatsApp digitado) para o serviço
// ---------------------------------------------------------------------
export type PackageOption = { id: string; name: string; remaining: number; sessions_total: number; expires_at: string | null };

export async function findCustomerPackages(phone: string, serviceId: string): Promise<PackageOption[]> {
  const { business } = await getAdminContext();
  const digits = phone.replace(/\D/g, "");
  if (!/^\d{10,11}$/.test(digits) || !serviceId) return [];

  const supabase = createClient();
  const { data: customer } = await supabase
    .from("customers").select("id").eq("business_id", business.id).eq("phone", digits).maybeSingle();
  if (!customer) return [];

  const { data } = await supabase
    .from("customer_package_balance")
    .select("id, name, remaining, sessions_total, expires_at")
    .eq("customer_id", customer.id)
    .eq("service_id", serviceId)
    .eq("effective_status", "active")
    .order("sold_at");
  return (data ?? []) as PackageOption[];
}
