// Feriados nacionais do Brasil (lista fixa no código, sem consulta ao banco).
// Fixos pela data; móveis (Carnaval, Sexta-feira Santa, Corpus Christi) pela Páscoa.
// Estaduais e municipais ficam de fora: cada espaço cadastra em Bloqueios.
import { addDaysISO } from "@/lib/dates";

export type Holiday = { date: string; name: string; /** ponto facultativo (não é feriado oficial) */ optional?: boolean };

const FIXED: [string, string][] = [
  ["01-01", "Confraternização Universal"],
  ["04-21", "Tiradentes"],
  ["05-01", "Dia do Trabalho"],
  ["09-07", "Independência do Brasil"],
  ["10-12", "Nossa Senhora Aparecida"],
  ["11-02", "Finados"],
  ["11-15", "Proclamação da República"],
  ["11-20", "Dia da Consciência Negra"],
  ["12-25", "Natal"],
];

/** Domingo de Páscoa (algoritmo de Meeus/Jones/Butcher, calendário gregoriano) */
export function easterISO(year: number) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Feriados nacionais de um ano, em ordem de data */
export function brazilHolidays(year: number): Holiday[] {
  const easter = easterISO(year);
  const list: Holiday[] = [
    ...FIXED.map(([md, name]) => ({ date: `${year}-${md}`, name })),
    { date: addDaysISO(easter, -48), name: "Carnaval", optional: true },
    { date: addDaysISO(easter, -47), name: "Carnaval", optional: true },
    { date: addDaysISO(easter, -2), name: "Sexta-feira Santa" },
    { date: addDaysISO(easter, 60), name: "Corpus Christi", optional: true },
  ];
  return list.sort((x, y) => x.date.localeCompare(y.date));
}

/** Próximo feriado a partir de `today` (inclusive), olhando este ano e o seguinte */
export function nextHoliday(today: string): Holiday | null {
  const year = Number(today.slice(0, 4));
  return [...brazilHolidays(year), ...brazilHolidays(year + 1)].find((h) => h.date >= today) ?? null;
}
