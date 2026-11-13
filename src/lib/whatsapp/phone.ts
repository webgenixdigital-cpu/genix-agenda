// Números de WhatsApp no padrão do projeto (mesma regra do normalize_phone do banco)
import { BR, cleanCountry, normalizePhone as normalizeIntl } from "@/lib/phone";

/** Igual ao normalize_phone do banco: só dígitos, tira o 55 de números brasileiros */
export function normalizePhone(raw: string) {
  const d = raw.replace(/\D/g, "");
  return /^55\d{10,11}$/.test(d) ? d.slice(2) : d;
}

/** Número para o envio: país + número. Brasil (padrão) = normalize_phone + 55, como sempre — 45 */
export function toWhatsappNumber(raw: string, country?: string | null) {
  const c = cleanCountry(country);
  if (c === BR) return `55${normalizePhone(raw)}`;
  return `${c}${normalizeIntl(raw, c)}`;
}

/** "5511999990000:12@s.whatsapp.net" → "11999990000" (ou null) */
export function phoneFromJid(jid: unknown) {
  if (typeof jid !== "string") return null;
  const d = normalizePhone(jid.split("@")[0].split(":")[0]);
  return /^\d{8,15}$/.test(d) ? d : null;
}
