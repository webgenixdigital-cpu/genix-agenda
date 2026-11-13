// Telefone de cliente com país (45_telefone_internacional) — parte leve,
// sem a libphonenumber (vai para as telas sem pesar o carregamento).
// Brasil (+55) é o padrão e segue as regras de sempre: número nacional com
// DDD, 10–11 dígitos, sem o 55. Outros países: número nacional (sem o código
// do país), 4–14 dígitos, país + número ≤ 15 (E.164).
// As mesmas regras moram no banco: normalize_phone(p, país) e phone_is_valid.
// Validação completa (libphonenumber) e lista de países: lib/phone-intl.ts.

import { maskPhone } from "@/lib/format";

export const BR = "55";

const onlyDigits = (v: string) => v.replace(/\D/g, "");

/** Código do país vindo do banco/formulário: só dígitos, 1–3; senão Brasil */
export function cleanCountry(c: string | null | undefined) {
  const d = onlyDigits(c ?? "");
  return /^[1-9]\d{0,2}$/.test(d) ? d : BR;
}

/**
 * Igual ao normalize_phone(p, país) do banco:
 * - Brasil: só dígitos e tira o 55 de números com 12–13 dígitos;
 * - outros: só dígitos (o "00" do discador sai) e tira o próprio código do
 *   país quando digitado com "+"/"00", ou quando sobram ≥ 8 dígitos num
 *   total ≥ 11 (evita cortar o "39" de um celular italiano 39x…).
 */
export function normalizePhone(raw: string, country: string = BR) {
  const c = cleanCountry(country);
  const t = (raw ?? "").trim();
  if (c === BR) {
    const d = onlyDigits(t);
    return /^55\d{10,11}$/.test(d) ? d.slice(2) : d;
  }
  const explicit = /^(\+|00)/.test(t);
  let d = onlyDigits(t);
  if (t.startsWith("00")) d = d.slice(2);
  if (d.startsWith(c) && (explicit || (d.length >= 11 && d.length - c.length >= 8))) return d.slice(c.length);
  return d;
}

/** Igual ao phone_is_valid do banco (regra estrutural; a tela usa para liberar o botão) */
export function isPhoneShapeValid(country: string, national: string) {
  const c = cleanCountry(country);
  if (c === BR) return /^\d{10,11}$/.test(national);
  return /^\d{4,14}$/.test(national) && c.length + national.length <= 15;
}

/** Mensagem padrão de telefone inválido, por país */
export const phoneError = (country?: string | null) =>
  cleanCountry(country) === BR ? "Informe o WhatsApp com DDD." : "Confira o número de WhatsApp para o país escolhido.";

/** Grupos de 3 dígitos; um dígito sobrando junta no grupo anterior ("212 555 1234") */
function groupDigits(d: string) {
  const g = d.match(/.{1,3}/g) ?? [];
  if (g.length > 1 && g[g.length - 1].length === 1) g.splice(-2, 2, g[g.length - 2] + g[g.length - 1]);
  return g.join(" ");
}

/** Texto do campo (número nacional): Brasil "(35) 99999-0001"; outros "912 345 678" */
export function displayPhone(national: string, country?: string | null) {
  const c = cleanCountry(country);
  const d = onlyDigits(national ?? "").slice(0, c === BR ? 11 : 14);
  return c === BR ? maskPhone(d) : groupDigits(d);
}

/** Exibição: Brasil "(35) 99999-0001"; outros "+351 912 345 678" */
export function formatPhone(phone: string | null | undefined, country?: string | null) {
  const c = cleanCountry(country);
  const d = onlyDigits(phone ?? "");
  if (c === BR) return maskPhone(normalizePhone(d, BR));
  return `+${c} ${groupDigits(normalizePhone(d, c))}`;
}
