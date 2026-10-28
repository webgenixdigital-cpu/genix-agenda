// Datas sempre no fuso do Brasil (o servidor da Vercel roda em UTC)
const TZ = "America/Sao_Paulo";

/** "2026-10-07" (hoje em São Paulo) */
export function todayISO(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d);
}

/** "2026-10-01" (primeiro dia do mês atual) */
export function monthStartISO() {
  return todayISO().slice(0, 8) + "01";
}
/** "2026-10-07" + n dias (aritmética de calendário, sem fuso) */
export function addDaysISO(iso: string, n: number) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Segunda-feira da semana de uma data "yyyy-mm-dd" */
export function mondayOf(iso: string) {
  const weekday = new Date(`${iso}T12:00:00Z`).getUTCDay(); // 0 = domingo
  return addDaysISO(iso, -((weekday + 6) % 7));
}
