"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getAdminContext, getEditorContext } from "@/lib/admin";
import { customerSearchFilter } from "@/lib/customer-search";
import { cleanCountry, phoneError } from "@/lib/phone";
import { parseCustomerPhone } from "@/lib/phone-intl";

type Result = { ok: true } | { ok: false; error: string };
type Method = "pix" | "dinheiro" | "credito" | "debito";

const OVERLAP = "23P01"; // exclusion_violation (trava no_overlap)

// erros do trigger trg_validate_package (19_pacotes.sql)
const PACKAGE_ERRORS: Record<string, string> = {
  PACOTE_SEM_SALDO: "Esse pacote não tem mais sessões disponíveis.",
  PACOTE_VENCIDO: "Esse pacote vence antes da data escolhida.",
  PACOTE_INVALIDO: "Esse pacote não pode ser usado aqui (cancelado, de outro cliente ou de outro serviço).",
  // combos (32_combos), no gatilho do item 0
  PROFISSIONAL_NAO_FAZ: "Esse profissional não faz todos os serviços deste combo.",
  PLANO_GRATIS: "Combos são um recurso dos planos Profissional e Equipe.",
  COMBO_INCOMPLETO: "Esse combo está incompleto. Edite o combo em Serviços.",
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
// PARTE 2b — Reabrir concluído por engano (regras em 46_reabrir_atendimento.sql)
// Status volta ao anterior, sai o lançamento automático do caixa e o
// histórico ganha "reopened". Tudo numa transação, no banco.
// ---------------------------------------------------------------------
const REOPEN_ERRORS: Record<string, string> = {
  SEM_PERMISSAO: "Só a matriz e a recepção podem reabrir um atendimento.",
  PRAZO_SO_DONO: "Esse atendimento foi concluído há mais de 30 dias. Só a matriz pode reabrir.",
  CAIXA_EDITADO:
    "O lançamento deste atendimento no caixa foi alterado depois da conclusão. Confira o Financeiro com a matriz antes de reabrir.",
  HORARIO_OCUPADO: "Esse horário já foi ocupado por outro agendamento. Não dá para reabrir.",
  STATUS_INVALIDO: "Esse atendimento não está concluído.",
  NAO_ENCONTRADO: "Agendamento não encontrado.",
};

export async function reopenBooking(id: string): Promise<Result> {
  await getEditorContext();
  const supabase = createClient();
  const { error } = await supabase.rpc("reopen_booking", { p_booking: id });
  if (error) {
    const key = Object.keys(REOPEN_ERRORS).find((k) => error.message.includes(k));
    return { ok: false, error: (key && REOPEN_ERRORS[key]) || "Não foi possível reabrir o atendimento." };
  }

  refresh();
  revalidatePath("/admin/financeiro");
  revalidatePath("/admin/ganhos");
  revalidatePath("/admin/clientes", "layout");
  revalidatePath("/admin/lembretes");
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
  /** código do país (45); ausente = Brasil */
  customerPhoneCountry?: string;
  notes?: string;
  packageId?: string | null;
}): Promise<Result> {
  const { business } = await getEditorContext();
  const supabase = createClient();

  const name = input.customerName.trim();
  const parsedPhone = parseCustomerPhone(input.customerPhone, input.customerPhoneCountry);
  if (name.length < 2) return { ok: false, error: "Informe o nome do cliente." };
  if (!parsedPhone) return { ok: false, error: phoneError(input.customerPhoneCountry) };
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
    customer_phone: parsedPhone.phone,
    customer_phone_country: parsedPhone.country,
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

export async function findCustomerPackages(phone: string, serviceId: string, phoneCountry?: string): Promise<PackageOption[]> {
  const { business } = await getAdminContext();
  const parsedPhone = parseCustomerPhone(phone, phoneCountry);
  if (!parsedPhone || !serviceId) return [];

  const supabase = createClient();
  const { data: customer } = await supabase
    .from("customers").select("id").eq("business_id", business.id)
    .eq("phone_country", parsedPhone.country).eq("phone", parsedPhone.phone).maybeSingle();
  if (!customer) return [];

  // 37_plano_fechado: saldo do serviço dentro do pacote (pacote de vários serviços também vale)
  const { data } = await supabase
    .from("customer_package_item_balance")
    .select("customer_package_id, package_name, remaining, sessions_total, expires_at")
    .eq("customer_id", customer.id)
    .eq("service_id", serviceId)
    .eq("package_status", "active")
    .gt("remaining", 0)
    .order("sold_at");
  return ((data ?? []) as { customer_package_id: string; package_name: string; remaining: number; sessions_total: number; expires_at: string | null }[])
    .map((r) => ({
      id: r.customer_package_id,
      name: r.package_name,
      remaining: r.remaining,
      sessions_total: r.sessions_total,
      expires_at: r.expires_at,
    }));
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
  /** código do país (45); ausente = Brasil */
  customerPhoneCountry?: string;
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
    p_phone: input.customerPhone,
    p_country: cleanCountry(input.customerPhoneCountry),
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
    p_customer_phone: input.customerPhone,
    p_customer_country: cleanCountry(input.customerPhoneCountry),
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
  PROFISSIONAL_INDISPONIVEL: "Esse profissional não está disponível ou não faz todos os serviços deste agendamento.",
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
export type CustomerHit = { id: string; name: string; phone: string; phoneCountry: string; lastVisit: string | null };

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
    .select("id, name, phone, phone_country")
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

  return list.map((c) => ({
    id: c.id, name: c.name, phone: c.phone, phoneCountry: c.phone_country as string, lastVisit: last.get(c.id) ?? null,
  }));
}

// ---------------------------------------------------------------------
// PARTE 8 — Editar: serviços adicionais e desconto (31_editar_agendamento.sql)
// ---------------------------------------------------------------------
export type EditItem = {
  id: string;
  service_id: string | null;
  name: string;
  price: number;
  duration: number;
  position: number;
  extends_time: boolean;
  paid_by_package: boolean;
  /** 32_combos: itens do mesmo combo têm o mesmo grupo (removidos juntos) */
  combo_group: string | null;
  combo_name: string | null;
  /** 37_plano_fechado: serviço do pacote que pagou este item */
  package_item_id?: string | null;
};
/** Serviço de um pacote da cliente que pode pagar um adicional (saldo e validade na data) */
export type EditPackageOption = { id: string; service_id: string; package_name: string; remaining: number };
export type EditService = {
  id: string;
  name: string;
  price: number;
  duration: number;
  kind?: "servico" | "combo";
  /** combo: soma dos preços normais */
  normal_price?: number | null;
};
export type DiscountKind = "valor" | "percentual";
export type BookingEditInfo = {
  status: string;
  start_time: string;
  end_time: string;
  price: number;
  discount_kind: DiscountKind | null;
  discount_input: number | null;
  discount_amount: number;
  discount_reason: string | null;
  /** null = sem limite (matriz e recepção); número = % máximo do profissional */
  discount_limit: number | null;
  items: EditItem[];
  services: EditService[];
  package_options?: EditPackageOption[];
};

/** Conflitos ao aumentar o tempo: a tela oferece "Adicionar sem aumentar o tempo" */
export type EditConflict = "BLOQUEIO" | "OCUPADO" | "MEIA_NOITE";

const EDIT_ERRORS: Record<string, string> = {
  DESCONTO_ACIMA_LIMITE: "Esse desconto passa do limite que o espaço liberou para você.",
  BLOQUEIO: "Com esse serviço, o atendimento entra num horário bloqueado.",
  OCUPADO: "Com esse serviço, o atendimento bate no próximo horário da agenda.",
  MEIA_NOITE: "Com esse serviço, o atendimento passaria da meia-noite.",
  SERVICO_INVALIDO: "Escolha um serviço ativo.",
  PROFISSIONAL_NAO_FAZ: "Esse profissional não faz esse serviço.",
  LIMITE_ITENS: "O agendamento já tem o máximo de 10 serviços.",
  ITEM_ORIGINAL: "O serviço original não pode ser removido.",
  PLANO_GRATIS: "Combos são um recurso dos planos Profissional e Equipe.",
  COMBO_INCOMPLETO: "Esse combo está incompleto. Edite o combo em Serviços.",
  ITEM_INVALIDO: "Esse serviço já não está no agendamento.",
  DESCONTO_INVALIDO: "Informe um desconto válido (em % no máximo 100).",
  SEM_VALOR: "Não há valor a descontar neste agendamento.",
  STATUS_INVALIDO: "Só dá para editar agendamentos pendentes ou confirmados.",
  PACOTE_SEM_SALDO: "Esse pacote não tem mais sessões desse serviço.",
  PACOTE_VENCIDO: "Esse pacote vence antes da data deste agendamento.",
  PACOTE_INVALIDO: "Esse pacote não pode pagar este serviço (cancelado, de outra cliente ou sem esse serviço).",
  SEM_PERMISSAO: "Você não pode editar este agendamento.",
  NAO_ENCONTRADO: "Agendamento não encontrado.",
};
const editErrorKey = (message?: string) => Object.keys(EDIT_ERRORS).find((k) => message?.includes(k));
function editError(message?: string) {
  const key = editErrorKey(message);
  if (key === "DESCONTO_ACIMA_LIMITE") {
    const lim = /DESCONTO_ACIMA_LIMITE:([\d.]+)/.exec(message ?? "")?.[1];
    const pct = lim ? Number(lim).toLocaleString("pt-BR", { maximumFractionDigits: 2 }) : null;
    return pct === "0" || !pct
      ? "Você não pode dar desconto. Peça para a matriz ou a recepção."
      : `Seu limite de desconto é de ${pct}%. Peça para a matriz ou a recepção se precisar de mais.`;
  }
  return (key && EDIT_ERRORS[key]) || "Não foi possível salvar a alteração.";
}

function refreshEdit() {
  refresh();
  revalidatePath("/admin/clientes", "layout");
  revalidatePath("/admin/lembretes");
}

export async function getBookingEditInfo(id: string): Promise<{ ok: true; info: BookingEditInfo } | { ok: false; error: string }> {
  await getAdminContext();
  const supabase = createClient();
  const { data, error } = await supabase.rpc("booking_edit_info", { p_booking: id });
  if (error || !data) return { ok: false, error: editError(error?.message) };
  const r = data as BookingEditInfo;
  return {
    ok: true,
    info: {
      ...r,
      price: Number(r.price),
      discount_input: r.discount_input === null ? null : Number(r.discount_input),
      discount_amount: Number(r.discount_amount),
      discount_limit: r.discount_limit === null ? null : Number(r.discount_limit),
      items: r.items.map((i) => ({ ...i, price: Number(i.price) })),
      package_options: (r.package_options ?? []).map((o) => ({ ...o, remaining: Number(o.remaining) })),
      services: r.services.map((s) => ({
        ...s,
        price: Number(s.price),
        normal_price: s.normal_price == null ? null : Number(s.normal_price),
      })),
    },
  };
}

export async function addBookingItem(
  id: string,
  serviceId: string,
  extend: boolean,
  /** serviço do pacote da cliente que paga o adicional (null = cobra) */
  packageItemId: string | null = null
): Promise<{ ok: true } | { ok: false; error: string; conflict?: EditConflict }> {
  await getEditorContext();
  const supabase = createClient();
  const { error } = await supabase.rpc("booking_add_item", {
    p_booking: id,
    p_service: serviceId,
    p_extend: extend,
    p_package_item: packageItemId,
  });
  if (error) {
    const key = editErrorKey(error.message);
    const conflict = extend && (key === "BLOQUEIO" || key === "OCUPADO" || key === "MEIA_NOITE") ? key : undefined;
    return { ok: false, error: editError(error.message), conflict };
  }
  refreshEdit();
  return { ok: true };
}

export async function removeBookingItem(id: string, itemId: string): Promise<Result> {
  await getEditorContext();
  const supabase = createClient();
  const { error } = await supabase.rpc("booking_remove_item", { p_booking: id, p_item: itemId });
  if (error) return { ok: false, error: editError(error.message) };
  refreshEdit();
  return { ok: true };
}

export async function setBookingDiscount(
  id: string,
  kind: DiscountKind | null,
  value: number | null,
  reason?: string
): Promise<Result> {
  await getEditorContext();
  if (kind && (!Number.isFinite(value) || (value ?? 0) <= 0)) return { ok: false, error: "Informe o valor do desconto." };
  const supabase = createClient();
  const { error } = await supabase.rpc("booking_set_discount", {
    p_booking: id,
    p_kind: kind,
    p_value: kind ? value : null,
    p_reason: kind ? reason?.trim().slice(0, 120) || null : null,
  });
  if (error) return { ok: false, error: editError(error.message) };
  refreshEdit();
  return { ok: true };
}
