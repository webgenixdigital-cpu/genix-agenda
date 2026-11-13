// Filtro de busca de clientes por nome ou WhatsApp (tela Clientes e Novo agendamento)

export type CustomerFilter = { column: "name" | "phone_e164"; pattern: string } | null;

/**
 * minDigits: a partir de quantos dígitos o termo vira busca por telefone.
 * Remove caracteres que quebram o filtro do PostgREST e escapa os curingas do ilike.
 * Telefone busca em phone_e164 (país + número, 45): acha tanto "35 99999…"
 * quanto "+351 912…" e "55 35 99999…".
 */
export function customerSearchFilter(raw: string, minDigits: number): CustomerFilter {
  const q = raw.replace(/[,()%]/g, " ").trim().slice(0, 60);
  if (!q) return null;
  const digits = q.replace(/\D/g, "");
  if (digits.length >= minDigits) {
    return { column: "phone_e164", pattern: `%${digits}%` };
  }
  return { column: "name", pattern: `%${q.replace(/[\\_]/g, (c) => `\\${c}`)}%` };
}
