// Pacote com datas fixas (48_pacote_servicos_por_data): datas das regras e
// sugestão de quais serviços vão em cada data. Só cálculo (servidor e navegador);
// o banco confere tudo de novo (saldo, validade, horário) na prévia e na venda.

export type PlanFrequency = "weekly" | "biweekly" | "monthly";

export type PlanRule = {
  professional_id: string;
  service_ids: string[];
  start_date: string; // AAAA-MM-DD
  time: string; // HH:MM
  frequency: PlanFrequency;
  count: number;
};

/** Uma data da venda: o que vai para o banco (service_ids vazio = não vira visita) */
export type PlanVisit = {
  rule: number;
  date: string;
  time: string;
  professional_id: string;
  service_ids: string[];
};

const iso = (d: Date) => d.toISOString().slice(0, 10);
const utc = (s: string) => new Date(`${s}T12:00:00Z`);

/** Mesma conta da series_dates (20_recorrencia): mensal cai no último dia quando o mês não tem o dia */
export function ruleDates(frequency: PlanFrequency, start: string, count: number): string[] {
  const n = Math.min(Math.max(Math.trunc(count) || 0, 0), 52);
  const s = utc(start);
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    if (frequency === "monthly") {
      const first = new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth() + i, 1, 12));
      const last = new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth() + i + 1, 0, 12)).getUTCDate();
      first.setUTCDate(Math.min(s.getUTCDate(), last));
      out.push(iso(first));
    } else {
      const d = new Date(s);
      d.setUTCDate(d.getUTCDate() + i * (frequency === "weekly" ? 7 : 14));
      out.push(iso(d));
    }
  }
  return out;
}

export function addDays(date: string, n: number) {
  const d = utc(date);
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
}

/**
 * Datas de todas as regras, em ordem de data/horário, com a sugestão de serviços:
 * cada serviço é espalhado o mais uniforme possível entre as datas em que pode entrar
 * (regra marca o serviço, profissional faz e a data está dentro da validade),
 * até o saldo do pacote. Ex.: 4 manicures + 2 pedicures em 4 semanas →
 * Manicure em todas, Pedicure na 2ª e na 4ª.
 */
export function suggestVisits(
  rules: PlanRule[],
  services: { id: string; sessions: number }[],
  expires: string | null,
  proDoes: (professionalId: string, serviceId: string) => boolean
): PlanVisit[] {
  const visits: PlanVisit[] = rules
    .flatMap((r, rule) =>
      ruleDates(r.frequency, r.start_date, r.count).map((date) => ({
        rule,
        date,
        time: r.time,
        professional_id: r.professional_id,
        service_ids: [] as string[],
      }))
    )
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time) || a.rule - b.rule);

  for (const s of services) {
    const eligible = visits
      .map((v, i) => ({ v, i }))
      .filter(
        ({ v }) =>
          rules[v.rule].service_ids.includes(s.id) &&
          proDoes(v.professional_id, s.id) &&
          (!expires || v.date <= expires)
      );
    const n = Math.min(s.sessions, eligible.length);
    for (let k = 0; k < n; k++) {
      // posições espalhadas: meio de cada fatia
      const pick = eligible[Math.floor(((k + 0.5) * eligible.length) / n)];
      pick.v.service_ids.push(s.id);
    }
  }

  // serviços na ordem do pacote (o primeiro é o principal da visita)
  const order = services.map((s) => s.id);
  for (const v of visits) v.service_ids.sort((a, b) => order.indexOf(a) - order.indexOf(b));
  return visits;
}

/** Quantas vezes cada serviço foi marcado nas datas */
export function markedCount(visits: PlanVisit[]) {
  const out: Record<string, number> = {};
  for (const v of visits) for (const id of v.service_ids) out[id] = (out[id] ?? 0) + 1;
  return out;
}
