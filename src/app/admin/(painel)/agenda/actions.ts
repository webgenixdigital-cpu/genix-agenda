"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getAdminContext, getEditorContext } from "@/lib/admin";
import { customerSearchFilter } from "@/lib/customer-search";
import { cleanCountry, phoneError } from "@/lib/phone";
import { parseCustomerPhone } from "@/lib/phone-intl";
import { LOCKED_FEATURES, PLAN_ERRORS, minPlanLabel } from "@/lib/plan-features";
import { PET_NICHE_ID } from "@/lib/pets";
import { activeDrivers, pickDriver, type ActiveDriver } from "@/lib/drivers";

// 67: encaixe e recorrência saíram do Básico (o banco devolve PLANO_PROFISSIONAL_ENCAIXE / _RECORRENCIA;
// PLANO_BASICO / PLANO_GRATIS ficam para o intervalo entre o deploy e a migration)
const FIT_PLAN_ERROR = `Encaixe é um recurso dos ${minPlanLabel(LOCKED_FEATURES.encaixe.minPlan)}. No Grátis e no Básico, escolha um horário da lista.`;
const SERIES_PLAN_ERROR = `Agendamentos recorrentes são um recurso dos ${minPlanLabel(LOCKED_FEATURES.recorrencia.minPlan)}.`;

type Result = { ok: true } | { ok: false; error: string };
type Method = "pix" | "dinheiro" | "credito" | "debito";

const OVERLAP = "23P01"; // exclusion_violation (trava no_overlap)

// erros do trigger trg_validate_package (19_pacotes.sql)
const PACKAGE_ERRORS: Record<string, string> = {
  PLANO_CONSULTA: PLAN_ERRORS.PLANO_CONSULTA,   // 59: Grátis vencido = só consulta
  PACOTE_SEM_SALDO: "Esse pacote não tem mais sessões disponíveis.",
  PACOTE_VENCIDO: "Esse pacote vence antes da data escolhida.",
  PACOTE_INVALIDO: "Esse pacote não pode ser usado aqui (cancelado, de outro cliente ou de outro serviço).",
  // combos (32_combos), no gatilho do item 0
  PROFISSIONAL_NAO_FAZ: "Esse profissional não faz todos os serviços deste combo.",
  PLANO_PROFISSIONAL_ENCAIXE: FIT_PLAN_ERROR,   // 67 (antes de PLANO_PROFISSIONAL: busca por trecho)
  PLANO_PROFISSIONAL: "Combos são um recurso dos planos Profissional e Equipe.",
  PLANO_GRATIS: "Combos são um recurso dos planos Profissional e Equipe.",
  COMBO_INCOMPLETO: "Esse combo está incompleto. Edite o combo em Serviços.",
  // 52 (até a migration 67 rodar): encaixe fora da lista e encaixe sobreposto
  PLANO_BASICO: FIT_PLAN_ERROR,
};
const packageError = (message?: string) =>
  PACKAGE_ERRORS[Object.keys(PACKAGE_ERRORS).find((k) => message?.includes(k)) ?? ""];

// ---------------------------------------------------------------------
// PARTE 0 — 64_atendimento_por_pet: no nicho "Banho e tosa" cada agendamento é de 1 pet.
// O tutor continua sendo o cliente (o gatilho liga pelo WhatsApp); o pet entra
// depois de criado o agendamento. O banco confere pet ↔ tutor ↔ pacote.
// ---------------------------------------------------------------------
/** petId = pet já cadastrado do tutor; newPetName = cadastra o pet junto (tutor novo ou pet novo).
 *  transport (4a): leva e traz; a taxa fica registrada e é cobrada à parte (não entra no total). */
export type PetChoice = {
  petId?: string | null;
  newPetName?: string;
  transport?: Transport;
  /** "15,00" */
  transportFee?: string;
  transportAddress?: string;
  transportAddressRef?: string;
  /** só quando há mais de um motorista ativo; sem ele, o sistema escolhe */
  transportDriverId?: string | null;
};
export type Transport = "nenhum" | "busca" | "entrega" | "busca_entrega";
const TRANSPORTS: Transport[] = ["nenhum", "busca", "entrega", "busca_entrega"];
const feeNumber = (raw?: string) => {
  const n = Number((raw ?? "").replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : NaN;
};

type Supa = ReturnType<typeof createClient>;
type Biz = { id: string; subcategory: string | null };

const isPetBusiness = (b: Biz) => b.subcategory === PET_NICHE_ID;

/** Antes de criar: no nicho pet, exige o pet e confere se o pacote é dele */
async function checkPetChoice(supabase: Supa, business: Biz, pet: PetChoice, packageId?: string | null, role?: string) {
  if (!isPetBusiness(business)) return null;
  const transport = pet.transport ?? "nenhum";
  if (!TRANSPORTS.includes(transport)) return "Escolha o leva e traz.";
  if (transport !== "nenhum") {
    if (role !== "owner" && role !== "reception") return "Só a matriz e a recepção marcam leva e traz.";
    if ((pet.transportAddress ?? "").trim().length < 5) return "Informe o endereço do tutor para o leva e traz.";
    if ((pet.transportAddress ?? "").length > 200 || (pet.transportAddressRef ?? "").length > 120) return "Endereço muito longo.";
    const fee = feeNumber(pet.transportFee || "0");
    if (Number.isNaN(fee) || fee > 9999) return "Taxa do leva e traz inválida.";
  }
  const newName = pet.newPetName?.trim() ?? "";
  if (!pet.petId && !newName) return "Escolha o pet que vai ser atendido.";
  if (!pet.petId && newName.length > 60) return "Nome do pet: no máximo 60 caracteres.";
  if (packageId) {
    const { data: p } = await supabase
      .from("customer_packages").select("pet_id").eq("id", packageId).eq("business_id", business.id).maybeSingle();
    if (p?.pet_id && p.pet_id !== (pet.petId ?? null)) return "Esse pacote é de outro pet.";
  }
  return null;
}

/** Depois de criar: liga o pet (cadastra se for novo) aos agendamentos */
async function attachPet(supabase: Supa, business: Biz, bookingIds: string[], pet: PetChoice) {
  if (!isPetBusiness(business) || bookingIds.length === 0) return null;
  let petId = pet.petId ?? null;
  if (!petId) {
    const { data: b } = await supabase
      .from("bookings").select("customer_id").eq("id", bookingIds[0]).eq("business_id", business.id).maybeSingle();
    if (!b?.customer_id) return "Agendamento criado, mas não achei o tutor para cadastrar o pet. Edite pela ficha do cliente.";
    const { data: created, error } = await supabase
      .from("pets")
      .insert({ business_id: business.id, customer_id: b.customer_id, name: pet.newPetName!.trim() })
      .select("id").single();
    if (error || !created) return "Agendamento criado, mas não foi possível cadastrar o pet.";
    petId = created.id as string;
  }
  const { error } = await supabase
    .from("bookings").update({ pet_id: petId }).in("id", bookingIds).eq("business_id", business.id);
  if (error) return `Agendamento criado, mas não foi possível ligar o pet (${petError(error.message) ?? "tente pela agenda"}).`;
  return attachTransport(supabase, business, bookingIds, pet);
}

/** 4a: leva e traz — grava no agendamento, atualiza o endereço do tutor e cria as paradas (sem motorista) */
async function attachTransport(supabase: Supa, business: Biz, bookingIds: string[], pet: PetChoice) {
  const transport = pet.transport ?? "nenhum";
  if (transport === "nenhum" || bookingIds.length === 0) return null;
  const fail = "Agendamento criado, mas o leva e traz não foi salvo. Marque de novo pela tela Leva e traz.";

  const { data: first } = await supabase
    .from("bookings").select("customer_id").eq("id", bookingIds[0]).eq("business_id", business.id).maybeSingle();
  if (first?.customer_id) {
    await supabase.from("customers").update({
      address: pet.transportAddress!.trim(),
      address_ref: pet.transportAddressRef?.trim() || null,
    }).eq("id", first.customer_id).eq("business_id", business.id);
  }

  const { error: upErr } = await supabase
    .from("bookings").update({ transport, transport_fee: feeNumber(pet.transportFee || "0") })
    .in("id", bookingIds).eq("business_id", business.id);
  if (upErr) return fail;

  const kinds = transport === "busca_entrega" ? ["busca", "entrega"] : [transport];
  // motorista: o escolhido, o único ativo ou um livre no horário (cada data da série confere o seu)
  const { data: bks } = await supabase
    .from("bookings").select("id, booking_date, start_time").in("id", bookingIds).eq("business_id", business.id);
  const driverOf = new Map<string, string | null>();
  for (const b of (bks ?? []) as { id: string; booking_date: string; start_time: string }[]) {
    driverOf.set(b.id, await pickDriver(supabase, business.id, b, pet.transportDriverId));
  }
  const rows = bookingIds.flatMap((id) =>
    kinds.map((kind) => ({ business_id: business.id, booking_id: id, kind, driver_id: driverOf.get(id) ?? null }))
  );
  const { error: routeErr } = await supabase.from("transport_routes").insert(rows);
  return routeErr ? fail : null;
}

const PET_ERRORS: Record<string, string> = {
  "Este pet é de outro tutor": "este pet é de outro tutor",
  "Este pacote é de outro pet": "o pacote é de outro pet",
  "Pet não pertence a este espaço": "pet de outro espaço",
};
const petError = (message?: string) =>
  PET_ERRORS[Object.keys(PET_ERRORS).find((k) => message?.includes(k)) ?? ""];

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
/** Uma parte do pagamento (68): forma + valor */
export type PaymentPart = { method: Method; amount: number };

/** Confere as partes antes de mandar ao banco (o banco confere de novo) */
function cleanParts(parts: PaymentPart[]): PaymentPart[] | string {
  if (!Array.isArray(parts) || parts.length < 1 || parts.length > 4) return "Informe de 1 a 4 formas de pagamento.";
  const out: PaymentPart[] = [];
  for (const p of parts) {
    if (!["pix", "dinheiro", "credito", "debito"].includes(p?.method)) return "Escolha a forma de pagamento de cada parte.";
    const amount = Math.round(Number(p.amount) * 100) / 100;
    if (!Number.isFinite(amount) || amount <= 0) return "Informe um valor maior que zero em cada parte.";
    out.push({ method: p.method, amount });
  }
  return out;
}

const COMPLETE_ERRORS: Record<string, string> = {
  SEM_PERMISSAO: "Você não tem permissão para concluir este atendimento.",
  JA_CONCLUIDO: "Esse atendimento já foi concluído.",
  VALOR_ACIMA_DO_SALDO: "A soma das formas passa do valor a cobrar. Confira os valores.",
  FORMA_INVALIDA: "Escolha a forma de pagamento de cada parte.",
  VALOR_INVALIDO: "Informe um valor maior que zero em cada parte.",
};

/**
 * method "pendente" = "Escolher depois" (49): conclui sem caixa e fica Pagamento pendente.
 * payments (68) = dividir o pagamento: um lançamento por parte; soma menor que o cobrado
 * deixa o saldo como Pagamento pendente.
 */
export async function completeBooking(
  id: string,
  method: Method | "pendente" | null,
  payments?: PaymentPart[]
): Promise<Result> {
  await getEditorContext();
  let parts: PaymentPart[] | null = null;
  if (payments) {
    const c = cleanParts(payments);
    if (typeof c === "string") return { ok: false, error: c };
    parts = c;
  }
  const supabase = createClient();

  // status + lançamentos no caixa juntos, com a permissão conferida no banco
  const { error } = await supabase.rpc(
    "complete_booking",
    parts ? { p_booking: id, p_method: null, p_payments: parts } : { p_booking: id, p_method: method }
  );
  if (error) {
    const key = Object.keys(COMPLETE_ERRORS).find((k) => error.message.includes(k));
    return { ok: false, error: key ? COMPLETE_ERRORS[key] : "Não foi possível concluir o atendimento." };
  }

  refresh();
  revalidatePath("/admin/financeiro");
  revalidatePath("/admin/ganhos");
  revalidatePath("/admin");
  return { ok: true };
}

// ---------------------------------------------------------------------
// PARTE 2a — Pagamento pendente (49_pagamento_depois.sql)
// ---------------------------------------------------------------------
const PAYMENT_ERRORS: Record<string, string> = {
  PLANO_CONSULTA: PLAN_ERRORS.PLANO_CONSULTA,   // 59: Grátis vencido = só consulta
  SEM_PERMISSAO: "Você não pode registrar o pagamento deste atendimento.",
  PLANO_GRATIS: "Registrar pagamento no caixa é um recurso dos planos pagos, a partir do Básico.",
  NAO_PENDENTE: "Esse pagamento já foi registrado.",
  JA_LANCADO: "Esse atendimento já tem um lançamento no caixa.",
  VALOR_ACIMA_DO_SALDO: "O valor passa do que falta pagar. Confira os valores.",
  FORMA_INVALIDA: "Escolha a forma de pagamento de cada parte.",
  VALOR_INVALIDO: "Informe um valor maior que zero em cada parte.",
  DATA_INVALIDA: "A data do pagamento não pode ser no futuro.",
  NAO_ENCONTRADO: "Não encontrado.",
};
const paymentError = (message?: string) =>
  PAYMENT_ERRORS[Object.keys(PAYMENT_ERRORS).find((k) => message?.includes(k)) ?? ""] ??
  "Não foi possível registrar o pagamento.";

export type PaymentMethod = Method;
/** remaining = o que ainda falta pagar depois deste registro (0 = quitado) */
export type PaymentResult = { ok: true; remaining: number } | { ok: false; error: string };

function afterPayment() {
  refresh();
  revalidatePath("/admin/financeiro");
  revalidatePath("/admin/clientes", "layout");
  revalidatePath("/admin");
}

/** Atendimento com Pagamento pendente (49): uma ou mais partes (68); pode ser parcial */
export async function registerBookingPayment(input: {
  bookingId: string;
  payments: PaymentPart[];
  date: string; // AAAA-MM-DD
}): Promise<PaymentResult> {
  await getEditorContext();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) return { ok: false, error: "Escolha a data do pagamento." };
  const parts = cleanParts(input.payments);
  if (typeof parts === "string") return { ok: false, error: parts };
  const supabase = createClient();
  const { data, error } = await supabase.rpc("register_booking_payment", {
    p_booking: input.bookingId,
    p_payments: parts,
    p_date: input.date,
  });
  if (error) return { ok: false, error: paymentError(error.message) };
  afterPayment();
  return { ok: true, remaining: Number((data as { remaining?: number } | null)?.remaining ?? 0) };
}

/** Pacote vendido com "Escolher depois": matriz e recepção registram (lançamentos "pacote") */
export async function registerPackagePayment(input: {
  packageId: string;
  payments: PaymentPart[];
  date: string; // AAAA-MM-DD
}): Promise<PaymentResult> {
  await getEditorContext();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) return { ok: false, error: "Escolha a data do pagamento." };
  const parts = cleanParts(input.payments);
  if (typeof parts === "string") return { ok: false, error: parts };
  const supabase = createClient();
  const { data, error } = await supabase.rpc("register_package_payment", {
    p_package: input.packageId,
    p_payments: parts,
    p_date: input.date,
  });
  if (error) {
    return {
      ok: false,
      error: error.message.includes("SEM_PERMISSAO")
        ? "Só a matriz e a recepção registram o pagamento de pacotes."
        : paymentError(error.message),
    };
  }
  afterPayment();
  return { ok: true, remaining: Number((data as { remaining?: number } | null)?.remaining ?? 0) };
}

/** Total, já pago e o que falta (68), para o diálogo de Registrar pagamento. Só leitura. */
export async function getPaymentBalance(
  kind: "booking" | "package",
  id: string
): Promise<{ ok: true; total: number; paid: number; remaining: number } | { ok: false; error: string }> {
  await getAdminContext();
  const supabase = createClient();
  const { data, error } = await supabase.rpc("payment_balance", { p_kind: kind, p_id: id });
  if (error || !data) return { ok: false, error: "Não foi possível carregar o valor." };
  const d = data as { total: number; paid: number; remaining: number };
  return { ok: true, total: Number(d.total), paid: Number(d.paid), remaining: Number(d.remaining) };
}

// ---------------------------------------------------------------------
// PARTE 2b — Reabrir concluído por engano (regras em 46_reabrir_atendimento.sql)
// Status volta ao anterior, sai o lançamento automático do caixa e o
// histórico ganha "reopened". Tudo numa transação, no banco.
// ---------------------------------------------------------------------
const REOPEN_ERRORS: Record<string, string> = {
  PLANO_CONSULTA: PLAN_ERRORS.PLANO_CONSULTA,   // 59: Grátis vencido = só consulta
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
} & PetChoice): Promise<Result> {
  const { business, role } = await getEditorContext();
  const supabase = createClient();

  const petErr = await checkPetChoice(supabase, business, input, input.packageId, role);
  if (petErr) return { ok: false, error: petErr };

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

  const { data: created, error } = await supabase.from("bookings").insert({
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
  }).select("id").single();

  if (error) {
    return {
      ok: false,
      // 23P01: trava no_overlap ou encaixe sobreposto no horário (50)
      error: error.code === OVERLAP
        ? `${pro.name} já tem atendimento nesse horário.`
        : packageError(error.message) ?? "Não foi possível salvar o agendamento.",
    };
  }
  const attachErr = await attachPet(supabase, business, created ? [created.id as string] : [], input);
  refresh();
  if (input.packageId) revalidatePath("/admin/clientes");
  return attachErr ? { ok: false, error: attachErr } : { ok: true };
}

// ---------------------------------------------------------------------
// PARTE 3b — Encaixe sobreposto (50_encaixe_sobreposto.sql)
// Por cima de outro atendimento do mesmo profissional. Só a matriz (qualquer
// agenda) e o profissional (a própria); 1 por trecho; o banco confere tudo.
// ---------------------------------------------------------------------
const OVERLAY_ERRORS: Record<string, string> = {
  PLANO_CONSULTA: PLAN_ERRORS.PLANO_CONSULTA,   // 59: Grátis vencido = só consulta
  SEM_PERMISSAO: "Encaixe sobreposto: a matriz e a recepção marcam em qualquer agenda; o profissional, só na própria.",
  PROFISSIONAL_INDISPONIVEL: "Esse profissional não está ativo.",
  PROFISSIONAL_NAO_FAZ: "Esse profissional não faz esse serviço.",
  MEIA_NOITE: "O atendimento passaria da meia-noite.",
  BLOQUEIO: "Esse horário está bloqueado na agenda desse profissional.",
  JA_TEM_ENCAIXE: "Já existe um encaixe sobreposto nesse trecho. Só cabe um por vez.",
  LIVRE: "Não há atendimento nesse horário para ficar por baixo. Use um horário livre ou o encaixe comum.",
  PASSADO: "Escolha uma data e horário a partir de agora.",
  STATUS_INVALIDO: "Só dá para remarcar agendamentos pendentes ou confirmados.",
  NAO_ENCONTRADO: "Agendamento, serviço ou profissional não encontrado.",
  DADOS_INVALIDOS: "Confira serviço, profissional, data, horário, nome e WhatsApp.",
};
const overlayError = (message?: string, fallback = "Não foi possível salvar o encaixe sobreposto.") =>
  packageError(message) ??
  OVERLAY_ERRORS[Object.keys(OVERLAY_ERRORS).find((k) => message?.includes(k)) ?? ""] ??
  fallback;

export type OverlayItem = { id: string; start: string; end: string; customer: string; service: string; overlay: boolean };
export type OverlayCheck = {
  /** null = pode marcar */
  issue: string | null;
  /** texto do motivo (quando issue não é null) */
  message: string | null;
  /** fim do encaixe (HH:MM) */
  end: string | null;
  /** atendimentos que ficam embaixo */
  overlaps: OverlayItem[];
};

/** Prévia: pode marcar? quem fica embaixo? (bookingId = remarcar: duração e serviço do agendamento) */
export async function checkOverlay(input: {
  serviceId?: string | null;
  bookingId?: string | null;
  professionalId: string;
  date: string;
  time: string;
}): Promise<{ ok: true; check: OverlayCheck } | { ok: false; error: string }> {
  const { business } = await getAdminContext();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || !/^\d{2}:\d{2}$/.test(input.time) || !input.professionalId) {
    return { ok: false, error: "Escolha o profissional, a data e o horário." };
  }
  const supabase = createClient();
  const { data, error } = await supabase.rpc("overlay_booking_check", {
    p_business: business.id,
    p_service: input.serviceId || null,
    p_professional: input.professionalId,
    p_date: input.date,
    p_time: input.time,
    p_booking: input.bookingId || null,
  });
  if (error || !data) return { ok: false, error: overlayError(error?.message, "Não foi possível conferir o horário.") };
  const r = data as { issue: string | null; end: string | null; overlaps: OverlayItem[] | null };
  return {
    ok: true,
    check: {
      issue: r.issue,
      message: r.issue ? overlayError(r.issue) : null,
      end: r.end,
      overlaps: r.overlaps ?? [],
    },
  };
}

export async function createOverlayBooking(input: {
  serviceId: string;
  professionalId: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:MM
  customerName: string;
  customerPhone: string;
  customerPhoneCountry?: string;
  notes?: string;
  packageId?: string | null;
} & PetChoice): Promise<Result> {
  const { business, role } = await getEditorContext();
  const name = input.customerName.trim();
  const parsedPhone = parseCustomerPhone(input.customerPhone, input.customerPhoneCountry);
  if (name.length < 2) return { ok: false, error: "Informe o nome do cliente." };
  if (!parsedPhone) return { ok: false, error: phoneError(input.customerPhoneCountry) };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || !/^\d{2}:\d{2}$/.test(input.time)) {
    return { ok: false, error: "Escolha data e horário." };
  }

  const supabase = createClient();
  const petErr = await checkPetChoice(supabase, business, input, input.packageId, role);
  if (petErr) return { ok: false, error: petErr };
  const { data: overlayId, error } = await supabase.rpc("create_overlay_booking", {
    p_business: business.id,
    p_service: input.serviceId,
    p_professional: input.professionalId,
    p_date: input.date,
    p_time: input.time,
    p_customer_name: name,
    p_customer_phone: parsedPhone.phone,
    p_customer_country: parsedPhone.country,
    p_notes: input.notes?.trim() || null,
    p_package: input.packageId || null,
  });
  if (error) return { ok: false, error: overlayError(error.message) };
  const attachErr = await attachPet(supabase, business, overlayId ? [overlayId as string] : [], input);
  refresh();
  if (input.packageId) revalidatePath("/admin/clientes");
  return attachErr ? { ok: false, error: attachErr } : { ok: true };
}

export async function rescheduleOverlay(input: {
  bookingId: string;
  professionalId: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:MM
}): Promise<{ ok: true; date: string; time: string; professional: string } | { ok: false; error: string }> {
  await getEditorContext();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || !/^\d{2}:\d{2}$/.test(input.time)) {
    return { ok: false, error: "Escolha a data e o horário." };
  }
  const supabase = createClient();
  const { data, error } = await supabase.rpc("reschedule_overlay", {
    p_booking: input.bookingId,
    p_professional: input.professionalId,
    p_date: input.date,
    p_time: input.time,
  });
  if (error) return { ok: false, error: overlayError(error.message, "Não foi possível remarcar.") };

  refresh();
  revalidatePath("/admin/lembretes");
  revalidatePath("/admin/clientes");
  const r = data as { date: string; time: string; professional: string };
  return { ok: true, date: r.date, time: r.time, professional: r.professional };
}

// ---------------------------------------------------------------------
// PARTE 4 — Novo agendamento: cliente pelo WhatsApp (com todos os pacotes; 37_plano_fechado)
// e horários livres (47_horarios_agendamento_manual.sql)
// ---------------------------------------------------------------------
export type CustomerPackage = {
  id: string;
  name: string;
  expires_at: string | null;
  /** 64: pacote de um pet (null = do tutor / outros nichos) */
  petId: string | null;
  items: { serviceId: string; serviceName: string; remaining: number }[];
};

export type LookupPet = { id: string; name: string; size: string | null };

/** 4b: motoristas ativos (o novo agendamento só mostra a escolha com 2 ou mais) */
export async function listActiveDrivers(): Promise<ActiveDriver[]> {
  const { business, role } = await getAdminContext();
  if (!isPetBusiness(business) || (role !== "owner" && role !== "reception")) return [];
  return activeDrivers(createClient(), business.id);
}

/** Cliente exato pelo país + número (RLS: o profissional só acha quem já atendeu) */
export async function lookupCustomer(
  phone: string,
  phoneCountry?: string
): Promise<{ name: string; packages: CustomerPackage[]; pets: LookupPet[]; address: string | null; addressRef: string | null } | null> {
  const { business } = await getAdminContext();
  const parsedPhone = parseCustomerPhone(phone, phoneCountry);
  if (!parsedPhone) return null;

  const supabase = createClient();
  const { data: customer } = await supabase
    .from("customers").select("id, name").eq("business_id", business.id)
    .eq("phone_country", parsedPhone.country).eq("phone", parsedPhone.phone).maybeSingle();
  if (!customer) return null;

  const { data } = await supabase
    .from("customer_package_item_balance")
    .select("customer_package_id, package_name, service_id, service_name, remaining, expires_at, position")
    .eq("customer_id", customer.id)
    .eq("package_status", "active")
    .gt("remaining", 0)
    .order("sold_at")
    .order("position");

  const packages = new Map<string, CustomerPackage>();
  for (const r of (data ?? []) as {
    customer_package_id: string; package_name: string; service_id: string; service_name: string;
    remaining: number; expires_at: string | null;
  }[]) {
    const p = packages.get(r.customer_package_id) ??
      { id: r.customer_package_id, name: r.package_name, expires_at: r.expires_at, petId: null, items: [] };
    p.items.push({ serviceId: r.service_id, serviceName: r.service_name, remaining: r.remaining });
    packages.set(r.customer_package_id, p);
  }
  // 64: pets ativos do tutor e o pet de cada pacote (nicho "Banho e tosa")
  let pets: LookupPet[] = [];
  let address: string | null = null;
  let addressRef: string | null = null;
  if (isPetBusiness(business)) {
    const { data: addr } = await supabase.from("customers").select("address, address_ref").eq("id", customer.id).maybeSingle();
    address = (addr?.address as string | null) ?? null;
    addressRef = (addr?.address_ref as string | null) ?? null;
    const ids = Array.from(packages.keys());
    const [{ data: petRows }, { data: pkgPets }] = await Promise.all([
      supabase.from("pets").select("id, name, size").eq("customer_id", customer.id).eq("active", true).order("created_at"),
      ids.length
        ? supabase.from("customer_packages").select("id, pet_id").in("id", ids)
        : Promise.resolve({ data: [] as { id: string; pet_id: string | null }[] }),
    ]);
    pets = (petRows ?? []) as LookupPet[];
    for (const r of pkgPets ?? []) {
      const p = packages.get(r.id);
      if (p) p.petId = r.pet_id;
    }
  }
  return { name: customer.name as string, packages: Array.from(packages.values()), pets, address, addressRef };
}

export type ManualSlot = { time: string; professionalIds: string[] };

/**
 * Horários em que pelo menos um profissional que faz o serviço está livre
 * (expediente, bloqueios — inclusive almoço e folga fixa —, duração e ocupados).
 * Com `time` = encaixe: confere só esse horário, sem expediente.
 */
export async function listManualSlots(
  serviceId: string,
  date: string,
  time?: string | null
): Promise<{ ok: true; slots: ManualSlot[] } | { ok: false; error: string }> {
  const { business } = await getAdminContext();
  if (!serviceId || !/^\d{4}-\d{2}-\d{2}$/.test(date) || (time && !/^\d{2}:\d{2}$/.test(time))) {
    return { ok: false, error: "Escolha o serviço, a data e o horário." };
  }
  const supabase = createClient();
  const { data, error } = await supabase.rpc("manual_booking_slots", {
    p_business: business.id,
    p_service: serviceId,
    p_date: date,
    p_time: time || null,
  });
  if (error) return { ok: false, error: "Não foi possível carregar os horários." };
  return {
    ok: true,
    slots: ((data ?? []) as { slot_time: string; professional_ids: string[] }[]).map((s) => ({
      time: s.slot_time,
      professionalIds: s.professional_ids,
    })),
  };
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
  PLANO_CONSULTA: PLAN_ERRORS.PLANO_CONSULTA,   // 59: Grátis vencido = só consulta
  PLANO_PROFISSIONAL_RECORRENCIA: SERIES_PLAN_ERROR,   // 67
  PLANO_GRATIS: SERIES_PLAN_ERROR,   // até a migration 67 rodar
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
  input: SeriesInput & PetChoice
): Promise<{ ok: true; created: number; skipped: SeriesDate[] } | { ok: false; error: string }> {
  const { business, role } = await getEditorContext();
  const supabase = createClient();
  const petErr = await checkPetChoice(supabase, business, input, input.packageId, role);
  if (petErr) return { ok: false, error: petErr };
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
  const attachErr = await attachPet(supabase, business, rows.flatMap((r) => (r.booking_id ? [r.booking_id] : [])), input);
  if (attachErr) {
    refresh();
    return { ok: false, error: attachErr };
  }
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
  PLANO_CONSULTA: PLAN_ERRORS.PLANO_CONSULTA,   // 59: Grátis vencido = só consulta
  PLANO_PROFISSIONAL_ENCAIXE: FIT_PLAN_ERROR,   // 67
  PLANO_BASICO: FIT_PLAN_ERROR,   // até a migration 67 rodar
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
export type EditPackageOption = {
  id: string;
  service_id: string;
  package_name: string;
  remaining: number;
  /** 57: pacote do serviço (para trocar o principal só dentro do mesmo pacote) */
  package_id?: string;
};
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
  /** 57: serviço (ou combo) principal do agendamento */
  main_service_id?: string | null;
  /** 57: pacote que paga o serviço principal (sessão de pacote); null = cobrado */
  main_package_id?: string | null;
};

/** Conflitos ao aumentar o tempo: a tela oferece "Adicionar sem aumentar o tempo" */
export type EditConflict = "BLOQUEIO" | "OCUPADO" | "MEIA_NOITE";

const EDIT_ERRORS: Record<string, string> = {
  PLANO_CONSULTA: PLAN_ERRORS.PLANO_CONSULTA,   // 59: Grátis vencido = só consulta
  DESCONTO_ACIMA_LIMITE: "Esse desconto passa do limite que o espaço liberou para você.",
  BLOQUEIO: "Com esse serviço, o atendimento entra num horário bloqueado.",
  OCUPADO: "Com esse serviço, o atendimento bate no próximo horário da agenda.",
  MEIA_NOITE: "Com esse serviço, o atendimento passaria da meia-noite.",
  SERVICO_INVALIDO: "Escolha um serviço ativo.",
  PROFISSIONAL_NAO_FAZ: "Esse profissional não faz esse serviço.",
  LIMITE_ITENS: "O agendamento já tem o máximo de 10 serviços.",
  ITEM_ORIGINAL: "O serviço original não pode ser removido.",
  PLANO_PROFISSIONAL: "Combos são um recurso dos planos Profissional e Equipe.",
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

// ---- Trocar o serviço principal (57_trocar_servico_principal) ----
const CHANGE_ERRORS: Record<string, string> = {
  PLANO_CONSULTA: PLAN_ERRORS.PLANO_CONSULTA,   // 59: Grátis vencido = só consulta
  STATUS_INVALIDO: "Só dá para trocar o serviço de agendamentos pendentes ou confirmados. Se já foi concluído, reabra o atendimento para trocar o serviço.",
  SEM_MUDANCA: "Esse já é o serviço do agendamento.",
  BLOQUEIO: "Com esse serviço, o atendimento entra num horário bloqueado. Remarque ou escolha outro serviço.",
  JA_TEM_ENCAIXE: "Com esse serviço, este encaixe bate em outro encaixe sobreposto. Remarque ou escolha outro serviço.",
  OCUPADO: "Com esse serviço, o atendimento bate no próximo horário da agenda. Remarque ou escolha outro serviço.",
  LIVRE: "Com esse serviço, este encaixe sobreposto ficaria sem atendimento embaixo. Remarque ou escolha outro serviço.",
  MEIA_NOITE: "Com esse serviço, o atendimento passaria da meia-noite. Remarque ou escolha outro serviço.",
  PACOTE_DESVINCULAR: "Esse serviço não é do pacote. Confirme que a sessão sai do pacote e passa a ser cobrada.",
  JA_NO_AGENDAMENTO: "Esse serviço do pacote já está nesta data. Use “Serviços do pacote nesta data”.",
};

export async function changeBookingService(
  id: string,
  serviceId: string,
  /** serviço do MESMO pacote que passa a pagar o principal (sessão de pacote) */
  packageItemId: string | null = null,
  /** sessão de pacote trocada por serviço de fora: sai do pacote e passa a ser cobrada */
  unlinkPackage = false
): Promise<Result> {
  await getEditorContext();
  const supabase = createClient();
  const { error } = await supabase.rpc("booking_change_service", {
    p_booking: id,
    p_service: serviceId,
    p_package_item: packageItemId,
    p_unlink_package: unlinkPackage,
  });
  if (error) {
    const key = Object.keys(CHANGE_ERRORS).find((k) => error.message.includes(k));
    return { ok: false, error: key ? CHANGE_ERRORS[key] : editError(error.message) };
  }
  refreshEdit();
  return { ok: true };
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

// ---- Serviços do pacote numa data já marcada (48_pacote_servicos_por_data) ----
export type PackageVisitItem = {
  package_item_id: string;
  service_id: string | null;
  service_name: string;
  sessions_total: number;
  /** usadas em outras datas (sem contar esta) */
  used_elsewhere: number;
  marked: boolean;
  main: boolean;
  can_do: boolean;
};
export type PackageVisitOptions = {
  package_name: string;
  expires_at: string | null;
  editable: boolean;
  items: PackageVisitItem[];
};

const PACKAGE_VISIT_ERRORS: Record<string, string> = {
  PLANO_CONSULTA: PLAN_ERRORS.PLANO_CONSULTA,   // 59: Grátis vencido = só consulta
  SERVICOS_VAZIOS: "Marque ao menos um serviço. Para não fazer nada nesta data, cancele o agendamento.",
  SERVICOS_INVALIDOS: "Escolha só serviços deste pacote.",
  NAO_E_PACOTE: "Este agendamento não é sessão de pacote.",
  PROFISSIONAL_NAO_FAZ: "O profissional desta data não faz um dos serviços marcados.",
};

/** null = o agendamento não é sessão de pacote */
export async function getPackageVisitOptions(
  id: string
): Promise<{ ok: true; options: PackageVisitOptions | null } | { ok: false; error: string }> {
  await getAdminContext();
  const supabase = createClient();
  const { data, error } = await supabase.rpc("package_visit_options", { p_booking: id });
  if (error) return { ok: false, error: editError(error.message) };
  if (!data) return { ok: true, options: null };
  const r = data as PackageVisitOptions;
  return {
    ok: true,
    options: {
      ...r,
      items: r.items.map((i) => ({ ...i, sessions_total: Number(i.sessions_total), used_elsewhere: Number(i.used_elsewhere) })),
    },
  };
}

export async function setPackageVisitServices(id: string, serviceIds: string[]): Promise<Result> {
  await getEditorContext();
  const supabase = createClient();
  const { error } = await supabase.rpc("package_visit_set_services", { p_booking: id, p_service_ids: serviceIds });
  if (error) {
    const key = Object.keys(PACKAGE_VISIT_ERRORS).find((k) => error.message.includes(k));
    return { ok: false, error: key ? PACKAGE_VISIT_ERRORS[key] : editError(error.message) };
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
