"use server";

import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { cleanCountry } from "@/lib/phone";
import { parseCustomerPhone } from "@/lib/phone-intl";
import { PET_NICHE_ID } from "@/lib/pets";

// ---------------------------------------------------------------------
// PARTE 1 — Tipos e mensagens
// ---------------------------------------------------------------------
export type PublicBookingInput = {
  slug: string;
  serviceId: string;
  date: string; // yyyy-MM-dd
  time: string; // HH:MM
  name: string;
  phone: string;
  /** código do país (45); ausente = Brasil */
  phoneCountry?: string;
  notes: string | null;
  professionalId: string | null;
  token: string;
  /** 64: banho e tosa — nome do pet atendido (obrigatório nesse nicho) */
  petName?: string;
};

export type PublicBooking = {
  id: string;
  service_name: string;
  professional_name: string;
  date: string;
  start_time: string;
  end_time: string;
  price: number;
  customer_name: string;
  /** 'confirmed' quando a confirmação automática do espaço aprovou (25_confirmacao_automatica) */
  status: "pending" | "confirmed";
  /** 64: banho e tosa — pet do agendamento */
  pet_name?: string | null;
};

type Result = { ok: true; booking: PublicBooking } | { ok: false; error: string; code?: string };

// códigos levantados por create_public_booking (03 e 22_protecao_vitrine)
const LIMIT_MESSAGE = "Você já tem horários marcados aqui. Para marcar mais, fale com o espaço pelo WhatsApp.";
const ERRORS: Record<string, string> = {
  HORARIO_INDISPONIVEL: "Esse horário acabou de ser reservado. Escolha outro horário.",
  DADOS_INVALIDOS: "Confira seu nome e o número de WhatsApp (com DDD ou código de área).",
  SERVICO_INVALIDO: "Este serviço não está disponível para agendamento online.",
  ESTABELECIMENTO_NAO_ENCONTRADO: "Este espaço não está recebendo agendamentos online.",
  // 52: mensagem neutra (sem dizer o motivo ao cliente final)
  AGENDA_INDISPONIVEL: "No momento, este espaço não está recebendo agendamentos online. Fale com o espaço pelo WhatsApp.",
  LIMITE_ESPACO: LIMIT_MESSAGE,
  LIMITE_DIARIO: LIMIT_MESSAGE,
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------------
// PARTE 2 — Cloudflare Turnstile
// ---------------------------------------------------------------------
function clientIp() {
  const h = headers();
  // Vercel: o 1º item de x-forwarded-for é o IP real do visitante
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || undefined;
}

async function verifyTurnstile(token: string): Promise<string | null> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    return process.env.NODE_ENV === "production"
      ? "Agendamento online indisponível no momento. Fale com o espaço pelo WhatsApp."
      : "Turnstile não configurado: defina TURNSTILE_SECRET_KEY no .env.local.";
  }
  if (!token) return "Confirme que você não é um robô antes de agendar.";

  const body = new URLSearchParams({ secret, response: token });
  const ip = clientIp();
  if (ip) body.set("remoteip", ip);

  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body,
      cache: "no-store",
    });
    const data = (await res.json()) as { success?: boolean };
    return data.success ? null : "Não conseguimos confirmar que você não é um robô. Tente novamente.";
  } catch {
    return "Não conseguimos validar o envio agora. Tente novamente em instantes.";
  }
}

// ---------------------------------------------------------------------
// PARTE 3 — Criar agendamento pela vitrine
// Recebe só o slug (nunca business_id do navegador). A única chamada com
// service role é create_public_booking, que revalida tudo no banco.
// 64 (banho e tosa): depois, o pet entra SÓ no agendamento que essa chamada
// acabou de criar (id devolvido pelo banco, nunca do navegador).
// ---------------------------------------------------------------------

/** Banho e tosa: o espaço é do nicho pet? (pelo slug; outros nichos não fazem nada a mais) */
async function isPetVitrine(slug: string) {
  const { data } = await createAdminClient()
    .from("businesses").select("subcategory").eq("slug", slug).eq("is_published", true).maybeSingle();
  return data?.subcategory === PET_NICHE_ID;
}

/** Liga o pet ao agendamento recém-criado: usa o pet do tutor com o mesmo nome ou cadastra. Nunca derruba o agendamento. */
async function attachPublicPet(bookingId: string, petName: string) {
  const db = createAdminClient();
  const { data: b } = await db
    .from("bookings").select("id, business_id, customer_id, pet_id, source").eq("id", bookingId).maybeSingle();
  if (!b?.customer_id || b.pet_id || b.source !== "online") return null;

  const name = petName.trim().slice(0, 60);
  const { data: same } = await db
    .from("pets").select("id, name").eq("business_id", b.business_id).eq("customer_id", b.customer_id)
    .eq("active", true).ilike("name", name.replace(/[%_\\]/g, "\\$&")).limit(1).maybeSingle();
  let petId = same?.id as string | undefined;
  if (!petId) {
    const { data: created } = await db
      .from("pets").insert({ business_id: b.business_id, customer_id: b.customer_id, name }).select("id").single();
    petId = created?.id as string | undefined;
  }
  if (!petId) return null;
  const { error } = await db.from("bookings").update({ pet_id: petId }).eq("id", b.id).is("pet_id", null);
  return error ? null : name;
}
export async function createPublicBooking(input: PublicBookingInput): Promise<Result> {
  if (
    typeof input.slug !== "string" ||
    !UUID.test(input.serviceId ?? "") ||
    !/^\d{4}-\d{2}-\d{2}$/.test(input.date ?? "") ||
    !/^\d{2}:\d{2}$/.test(input.time ?? "") ||
    (input.professionalId !== null && !UUID.test(input.professionalId ?? ""))
  ) {
    return { ok: false, error: "Dados do agendamento inválidos. Recarregue a página e tente novamente." };
  }

  // 64: banho e tosa pede o nome do pet (o resto da vitrine não muda)
  const petName = typeof input.petName === "string" ? input.petName.trim() : "";
  const petVitrine = await isPetVitrine(input.slug);
  if (petVitrine && (petName.length < 1 || petName.length > 60)) {
    return { ok: false, error: "Informe o nome do pet.", code: "DADOS_INVALIDOS" };
  }

  const captchaError = await verifyTurnstile(input.token);
  if (captchaError) return { ok: false, error: captchaError, code: "CAPTCHA" };

  // 45: número de outro país confere com a libphonenumber antes de ir ao banco
  // (Brasil continua só com a regra do banco: 10–11 dígitos com DDD)
  if (!parseCustomerPhone(input.phone, input.phoneCountry)) {
    return { ok: false, error: ERRORS.DADOS_INVALIDOS, code: "DADOS_INVALIDOS" };
  }

  const { data, error } = await createAdminClient().rpc("create_public_booking", {
    p_slug: input.slug,
    p_service_id: input.serviceId,
    p_date: input.date,
    p_time: input.time,
    p_customer_name: input.name,
    p_customer_phone: input.phone,
    p_customer_notes: input.notes || null,
    p_professional_id: input.professionalId,
    // 45: o banco normaliza e valida país + número (Brasil = regra de sempre)
    p_customer_country: cleanCountry(input.phoneCountry),
  });

  if (error) {
    const code = Object.keys(ERRORS).find((k) => error.message.includes(k));
    return {
      ok: false,
      code,
      error: code ? ERRORS[code] : "Não foi possível concluir o agendamento. Tente novamente.",
    };
  }
  const booking = data as PublicBooking;
  if (petVitrine) {
    try {
      booking.pet_name = await attachPublicPet(booking.id, petName);
    } catch {
      booking.pet_name = null; // agendamento já criado; o espaço liga o pet pela agenda
    }
  }
  return { ok: true, booking };
}
