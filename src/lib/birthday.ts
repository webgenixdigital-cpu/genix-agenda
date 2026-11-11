// Aniversário do cliente: só dia e mês. customers.birth_date guarda sempre o
// ano 2000 (bissexto, aceita 29/02) — migration 43. Nunca calcular idade.

export const BIRTH_YEAR = 2000;

export const MONTHS = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
] as const;

/** Dias do mês (1–12) no ano 2000: fevereiro tem 29 */
export const daysInMonth = (month: number) => new Date(Date.UTC(BIRTH_YEAR, month, 0)).getUTCDate();

/** "2000-03-12" a partir de dia e mês; "" se faltar algum ou o dia não existir no mês */
export function birthISO(day: number | null, month: number | null) {
  if (!day || !month || month < 1 || month > 12 || day < 1 || day > daysInMonth(month)) return "";
  return `${BIRTH_YEAR}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Dia e mês de uma data "aaaa-mm-dd" (qualquer ano) */
export function birthParts(iso: string | null | undefined): { day: number | null; month: number | null } {
  const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(iso ?? "");
  return m ? { month: Number(m[1]), day: Number(m[2]) } : { day: null, month: null };
}

/** "12 de março" */
export function birthdayLabel(iso: string) {
  const { day, month } = birthParts(iso);
  return day && month ? `${day} de ${MONTHS[month - 1]}` : "";
}
