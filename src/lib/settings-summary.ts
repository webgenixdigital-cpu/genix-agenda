// Resumos curtos das seções recolhidas de Configurações (servidor)

const SHORT = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
// segunda primeiro, domingo por último
const ORDER = [1, 2, 3, 4, 5, 6, 0];

/** "09:00" → "9h"; "09:30" → "9h30" */
export function shortHour(t: string) {
  const [h, m] = t.slice(0, 5).split(":");
  return `${Number(h)}h${m && m !== "00" ? m : ""}`;
}

type Hour = { weekday: number; closed: boolean; open_time: string | null; close_time: string | null };

/** "seg a sáb, 9h–19h" · "seg, qua a sex, 9h–18h" · "seg a sex, horários variados" */
export function hoursSummary(hours: Hour[]) {
  if (hours.length === 0) return "ainda não configurados";
  const open = ORDER.map((d) => hours.find((h) => h.weekday === d)).filter(
    (h): h is Hour => !!h && !h.closed && !!h.open_time && !!h.close_time
  );
  if (open.length === 0) return "fechado todos os dias";

  // agrupa por horário, na ordem da semana: "ter a sex, 9h–19h · sáb, 9h–17h"
  const groups = new Map<string, number[]>();
  for (const h of open) {
    const key = `${shortHour(h.open_time!)}–${shortHour(h.close_time!)}`;
    groups.set(key, [...(groups.get(key) ?? []), ORDER.indexOf(h.weekday)]);
  }
  if (groups.size > 3) return `${dayRanges(open.map((h) => ORDER.indexOf(h.weekday)))}, horários variados`;
  return Array.from(groups, ([time, pos]) => `${dayRanges(pos)}, ${time}`).join(" · ");
}

/** posições na semana (0 = seg) → "seg a sex", "seg, qua", "ter a qui, sáb" */
function dayRanges(positions: number[]) {
  const ranges: string[] = [];
  let start = 0;
  for (let i = 1; i <= positions.length; i++) {
    if (i === positions.length || positions[i] !== positions[i - 1] + 1) {
      const a = SHORT[ORDER[positions[start]]];
      const b = SHORT[ORDER[positions[i - 1]]];
      ranges.push(i - 1 === start ? a : i - 1 === start + 1 ? `${a}, ${b}` : `${a} a ${b}`);
      start = i;
    }
  }
  return ranges.join(", ");
}
