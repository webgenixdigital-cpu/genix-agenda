"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getAdminContext, getEditorContext } from "@/lib/admin";
import { customerSearchFilter } from "@/lib/customer-search";

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

// ---------------------------------------------------------------------
// PARTE 5 — Agendamentos recorrentes (regras no banco: 20_recorrencia.sql)
// ---------------------------------------------------------------------
export type SeriesFrequency = "weekly" | "biweekly" | "monthly";

export type SeriesInput = {
  serviceId: string;
  professionalId: string;
  date: string; // primeira data, YYYY-MM-DD
  time: string; // HH:MM
  frequency: SeriesFrequency;
  count: number;
  customerName: string;
  customerPhone: string;
  notes?: string;
  packageId?: string | null;
};

export type SeriesDate = { seq: number; date: string; issue: string | null };

const SERIES_ERRORS: Record<string, string> = {
  PLANO_GRATIS: "Agendamentos recorrentes são um recurso dos planos Profissional e Equipe.",
  SEM_PERMISSAO: "Você só pode agendar na sua própria agenda.",
  FREQUENCIA_INVALIDA: "Escolha a frequência.",
  QUANTIDADE_INVALIDA: "Escolha de 1 a 52 vezes.",
  DADOS_INVALIDOS: "Confira serviço, profissional, data, horário, nome e WhatsApp.",
  PACOTE_INVALIDO: "Esse pacote não pode ser usado aqui (cancelado, de outro cliente ou de outro serviço).",
  NAO_ENCONTRADO: "Série não encontrada.",
};
const seriesError = (message: string, fallback: string) =>
  SERIES_ERRORS[Object.keys(SERIES_ERRORS).find((k) => message.includes(k)) ?? ""] ?? fallback;

function seriesArgs(input: SeriesInput, businessId: string) {
  return {
    p_business: businessId,
    p_professional: input.professionalId,
    p_service: input.serviceId,
    p_date: input.date,
    p_time: input.time,
    p_frequency: input.frequency,
    p_count: input.count,
    p_package: input.packageId || null,
  };
}

/** Prévia: cada data com ✓ (issue null) ou o motivo. packageFit = sessões que cabem no pacote. */
export async function previewSeries(
  input: SeriesInput
): Promise<{ ok: true; dates: SeriesDate[]; packageFit: number | null; packageExpires: string | null } | { ok: false; error: string }> {
  const { business } = await getAdminContext();
  const supabase = createClient();
  const { data, error } = await supabase.rpc("preview_booking_series", {
    ...seriesArgs(input, business.id),
    p_phone: input.customerPhone.replace(/\D/g, ""),
  });
  if (error) return { ok: false, error: seriesError(error.message, "Não foi possível montar a prévia.") };

  const rows = (data ?? []) as { seq: number; occurs_on: string; issue: string | null; package_fit: number | null; package_expires: string | null }[];
  return {
    ok: true,
    dates: rows.map((r) => ({ seq: r.seq, date: r.occurs_on, issue: r.issue })),
    packageFit: rows[0]?.package_fit ?? null,
    packageExpires: rows[0]?.package_expires ?? null,
  };
}

export async function createSeries(
  input: SeriesInput
): Promise<{ ok: true; created: number; skipped: SeriesDate[] } | { ok: false; error: string }> {
  const { business } = await getEditorContext();
  const supabase = createClient();
  const { data, error } = await supabase.rpc("create_booking_series", {
    ...seriesArgs(input, business.id),
    p_customer_name: input.customerName.trim(),
    p_customer_phone: input.customerPhone.replace(/\D/g, ""),
    p_notes: input.notes?.trim() || null,
  });
  if (error) {
    const fit = /PACOTE_NAO_CABE:(\d+)/.exec(error.message);
    if (fit) return { ok: false, error: `O pacote só tem ${fit[1]} ${fit[1] === "1" ? "sessão disponível" : "sessões disponíveis"} para essas datas.` };
    return { ok: false, error: seriesError(error.message, "Não foi possível criar a série.") };
  }

  const rows = (data ?? []) as { seq: number; occurs_on: string; booking_id: string | null; issue: string | null }[];
  refresh();
  if (input.packageId) revalidatePath("/admin/clientes");
  return {
    ok: true,
    created: rows.filter((r) => r.booking_id).length,
    skipped: rows.filter((r) => !r.booking_id).map((r) => ({ seq: r.seq, date: r.occurs_on, issue: r.issue ?? "RECUSADO" })),
  };
}

export async function cancelSeriesFuture(seriesId: string): Promise<{ ok: true; cancelled: number } | { ok: false; error: string }> {
  await getEditorContext();
  const supabase = createClient();
  const { data, error } = await supabase.rpc("cancel_series_future", { p_series: seriesId });
  if (error) return { ok: false, error: seriesError(error.message, "Não foi possível cancelar a série.") };
  refresh();
  revalidatePath("/admin/clientes");
  return { ok: true, cancelled: Number(data ?? 0) };
}

// ---------------------------------------------------------------------
// PARTE 6 — Remarcar (mesmo agendamento; regras em 21_remarcar.sql)
// ---------------------------------------------------------------------
const RESCHEDULE_ERRORS: Record<string, string> = {
  PASSADO: "Escolha uma data e horário a partir de agora.",
  FECHADO: "O espaço não abre nesse dia.",
  FORA_EXPEDIENTE: "Esse horário fica fora do expediente.",
  PROFISSIONAL_INDISPONIVEL: "Esse profissional não está disponível para este serviço.",
  BLOQUEIO: "Esse horário está bloqueado na agenda desse profissional.",
  OCUPADO: "Esse horário acabou de ser ocupado. Escolha outro.",
  PACOTE_VENCIDO: "Esse pacote vence antes da nova data.",
  PACOTE_INVALIDO: "O pacote desta sessão foi cancelado. Cancele a sessão ou agende um horário avulso.",
  PACOTE_SEM_SALDO: "O pacote não tem saldo para esta sessão.",
  STATUS_INVALIDO: "Só dá para remarcar agendamentos pendentes ou confirmados.",
  SEM_PERMISSAO: "Você não pode remarcar este agendamento para essa agenda.",
  NAO_ENCONTRADO: "Agendamento não encontrado.",
  DADOS_INVALIDOS: "Escolha a data e o horário.",
};
const rescheduleError = (message?: string) =>
  RESCHEDULE_ERRORS[Object.keys(RESCHEDULE_ERRORS).find((k) => message?.includes(k)) ?? ""] ??
  "Não foi possível remarcar.";

/** Horários livres do dia para remarcar (ignora o próprio agendamento) */
export async function listRescheduleSlots(
  bookingId: string,
  professionalId: string,
  date: string
): Promise<{ ok: true; slots: string[] } | { ok: false; error: string }> {
  await getAdminContext();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, error: "Escolha a data." };
  const supabase = createClient();
  const { data, error } = await supabase.rpc("reschedule_slots", {
    p_booking: bookingId,
    p_professional: professionalId,
    p_date: date,
  });
  if (error) return { ok: false, error: rescheduleError(error.message) };
  return { ok: true, slots: ((data ?? []) as { slot_time: string }[]).map((s) => s.slot_time) };
}

export async function rescheduleBooking(input: {
  bookingId: string;
  professionalId: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:MM
  fit: boolean; // encaixe (matriz e recepção)
}): Promise<{ ok: true; date: string; time: string; professional: string } | { ok: false; error: string }> {
  await getEditorContext();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || !/^\d{2}:\d{2}$/.test(input.time)) {
    return { ok: false, error: "Escolha a data e o horário." };
  }
  const supabase = createClient();
  const { data, error } = await supabase.rpc("reschedule_booking", {
    p_booking: input.bookingId,
    p_professional: input.professionalId,
    p_date: input.date,
    p_time: input.time,
    p_fit: input.fit,
  });
  if (error) return { ok: false, error: rescheduleError(error.message) };

  refresh();
  revalidatePath("/admin/lembretes");
  revalidatePath("/admin/clientes");
  const r = data as { date: string; time: string; professional: string };
  return { ok: true, date: r.date, time: r.time, professional: r.professional };
}

// ---------------------------------------------------------------------
// PARTE 7 — Busca de cliente no novo agendamento
// Cliente normal (sem service role): a RLS de customers/bookings vale,
// então o profissional só encontra quem já atendeu.
// ---------------------------------------------------------------------
export type CustomerHit = { id: string; name: string; phone: string; lastVisit: string | null };

export async function searchCustomers(q: string): Promise<CustomerHit[]> {
  const { business } = await getAdminContext();
  const term = q.trim();
  const digits = term.replace(/\D/g, "");
  if (term.replace(/\d/g, "").trim().length < 2 && digits.length < 3) return [];

  const filter = customerSearchFilter(term, 3);
  if (!filter) return [];

  const supabase = createClient();
  const { data: customers } = await supabase
    .from("customers")
    .select("id, name, phone")
    .eq("business_id", business.id)
    .ilike(filter.column, filter.pattern)
    .order("name")
    .limit(8);
  const list = customers ?? [];
  if (list.length === 0) return [];

  // última visita concluída de cada um (a primeira de cada cliente na ordem decrescente)
  const { data: visits } = await supabase
    .from("bookings")
    .select("customer_id, booking_date")
    .in("customer_id", list.map((c) => c.id))
    .eq("status", "completed")
    .order("booking_date", { ascending: false })
    .limit(200);
  const last = new Map<string, string>();
  for (const v of visits ?? []) if (v.customer_id && !last.has(v.customer_id)) last.set(v.customer_id, v.booking_date);

  return list.map((c) => ({ id: c.id, name: c.name, phone: c.phone, lastVisit: last.get(c.id) ?? null }));
}
