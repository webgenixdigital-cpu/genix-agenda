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