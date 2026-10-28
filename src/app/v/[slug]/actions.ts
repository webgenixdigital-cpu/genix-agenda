"use server";

import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";

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
  notes: string | null;
  professionalId: string | null;
  token: string;
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
};

type Result = { ok: true; booking: PublicBooking } | { ok: false; error: string; code?: string };

// códigos levantados por create_public_booking (03 e 22_protecao_vitrine)
const LIMIT_MESSAGE = "Você já tem horários marcados aqui. Para marcar mais, fale com o espaço pelo WhatsApp.";
const ERRORS: Record<string, string> = {
  HORARIO_INDISPONIVEL: "Esse horário acabou de ser reservado. Escolha outro horário.",
  DADOS_INVALIDOS: "Confira seu nome e um WhatsApp com DDD.",
  SERVICO_INVALIDO: "Este serviço não está disponível para agendamento online.",
  ESTABELECIMENTO_NAO_ENCONTRADO: "Este espaço não está recebendo agendamentos online.",
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
// ---------------------------------------------------------------------
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

  const captchaError = await verifyTurnstile(input.token);
  if (captchaError) return { ok: false, error: captchaError, code: "CAPTCHA" };

  const { data, error } = await createAdminClient().rpc("create_public_booking", {
    p_slug: input.slug,
    p_service_id: input.serviceId,
    p_date: input.date,
    p_time: input.time,
    p_customer_name: input.name,
    p_customer_phone: input.phone,
    p_customer_notes: input.notes || null,
    p_professional_id: input.professionalId,
  });

  if (error) {
    const code = Object.keys(ERRORS).find((k) => error.message.includes(k));
    return {
      ok: false,
      code,
      error: code ? ERRORS[code] : "Não foi possível concluir o agendamento. Tente novamente.",
    };
  }
  return { ok: true, booking: data as PublicBooking };
}
