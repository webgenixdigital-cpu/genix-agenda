// Faturamento, limites e relatório para o contador (usado no servidor e no navegador)
// Não calcula imposto: só soma o caixa (regime de caixa) e compara com os limites
// da tabela revenue_limits, editada pela Genix.
import { brl } from "@/lib/format";
import { CATEGORY_LABEL, METHOD_LABEL, type CashMethod } from "@/lib/cash";

export type TaxRegime = "nanoempreendedor" | "mei" | "simples" | "outro";

export const REGIMES: TaxRegime[] = ["nanoempreendedor", "mei", "simples", "outro"];

export const REGIME_LABEL: Record<TaxRegime, string> = {
  nanoempreendedor: "Nanoempreendedor",
  mei: "MEI",
  simples: "Simples Nacional",
  outro: "Outro (sem limite acompanhado)",
};

export const NOTES = {
  disclaimer: "Relatório de apoio. Não substitui a apuração oficial. Confira com seu contador.",
  cashBasis: "Valores pelo regime de caixa (data do recebimento no caixa).",
  otherIncome: "Confira com seu contador se é receita da atividade (ex.: aporte ou reembolso não são faturamento).",
  partner: "O desconto do repasse vale para parcerias com contrato formalizado (Lei 13.352/2016).",
  commissionExpense: "Comissões lançadas como despesa aparecem nas despesas, mas não entram no cálculo do repasse.",
};

export type FiscalProfile = {
  regime: TaxRegime | null;
  activity_start: string | null; // YYYY-MM-DD
  partner_salon: boolean;
  cnpj: string | null;
};

export const EMPTY_FISCAL: FiscalProfile = { regime: null, activity_start: null, partner_salon: false, cnpj: null };

export type RevenueLimit = {
  id: string;
  regime: Exclude<TaxRegime, "outro">;
  basis: "annual" | "rbt12";
  annual_limit: number;
  first_year_monthly: number | null;
  sublimit: number | null;
  valid_from: string;
};

/** Linha de billing_monthly() */
export type BillingRow = {
  month: string; // YYYY-MM
  kind: "income" | "expense" | "repasse_pacote";
  category: string;
  method: string | null;
  amount: number;
  partner_amount: number;
};

/** Entradas que são receita da atividade; as demais ficam destacadas */
const ACTIVITY = new Set(["atendimento", "pacote", "produtos"]);

export const categoryLabel = (c: string) => CATEGORY_LABEL[c as keyof typeof CATEGORY_LABEL] ?? c;

export const baseLabel = (usesPartner: boolean) =>
  usesPartner
    ? "Base usada: cota-parte do salão (receita total − repasse aos parceiros)"
    : "Base usada: receita bruta total (todas as entradas do caixa)";

// ---------------------------------------------------------------------
// PARTE 1 — Meses (chaves YYYY-MM)
// ---------------------------------------------------------------------
export function addMonthsKey(key: string, n: number) {
  const [y, m] = key.split("-").map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
}

export function monthRange(from: string, to: string) {
  const list: string[] = [];
  for (let k = from; k <= to && list.length < 120; k = addMonthsKey(k, 1)) list.push(k);
  return list;
}

export function lastDayOf(key: string) {
  const [y, m] = key.split("-").map(Number);
  return `${key}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
}

const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
export const monthLabel = (key: string) => `${MONTHS[Number(key.slice(5, 7)) - 1]}/${key.slice(0, 4)}`;

// ---------------------------------------------------------------------
// PARTE 2 — Resumo por mês
// ---------------------------------------------------------------------
export type MonthSummary = {
  month: string;
  services: number;   // atendimento + pacote
  products: number;
  other: number;      // demais entradas (destacadas)
  income: number;     // total de entradas
  partner: number;    // repasse aos parceiros
  salonShare: number; // income − partner
  base: number;       // receita usada nos limites
  expense: number;
  byMethod: Record<CashMethod, number>;
  expenseByCategory: Record<string, number>;
  otherByCategory: Record<string, number>;
};

const r2 = (v: number) => Math.round(v * 100) / 100;

function emptyMonth(month: string): MonthSummary {
  return {
    month, services: 0, products: 0, other: 0, income: 0, partner: 0, salonShare: 0, base: 0, expense: 0,
    byMethod: { pix: 0, dinheiro: 0, credito: 0, debito: 0 },
    expenseByCategory: {}, otherByCategory: {},
  };
}

export function summarize(rows: BillingRow[], months: string[], usesPartner: boolean): MonthSummary[] {
  const map = new Map(months.map((m) => [m, emptyMonth(m)]));
  for (const r of rows) {
    const s = map.get(r.month);
    if (!s) continue;
    const amount = Number(r.amount);
    if (r.kind === "income") {
      s.income += amount;
      if (r.category === "produtos") s.products += amount;
      else if (ACTIVITY.has(r.category)) s.services += amount;
      else {
        s.other += amount;
        s.otherByCategory[r.category] = (s.otherByCategory[r.category] ?? 0) + amount;
      }
      if (r.method && r.method in s.byMethod) s.byMethod[r.method as CashMethod] += amount;
      s.partner += Number(r.partner_amount);
    } else if (r.kind === "expense") {
      s.expense += amount;
      s.expenseByCategory[r.category] = (s.expenseByCategory[r.category] ?? 0) + amount;
    } else {
      s.partner += Number(r.partner_amount);
    }
  }
  return months.map((m) => {
    const s = map.get(m)!;
    if (!usesPartner) s.partner = 0;
    s.partner = r2(s.partner);
    s.salonShare = r2(s.income - s.partner);
    s.base = usesPartner ? s.salonShare : r2(s.income);
    return s;
  });
}

/** Soma vários meses num só (totais do período) */
export function sumMonths(list: MonthSummary[], label = "total"): MonthSummary {
  const t = emptyMonth(label);
  for (const s of list) {
    t.services += s.services; t.products += s.products; t.other += s.other; t.income += s.income;
    t.partner += s.partner; t.salonShare += s.salonShare; t.base += s.base; t.expense += s.expense;
    for (const k of Object.keys(t.byMethod) as CashMethod[]) t.byMethod[k] += s.byMethod[k];
    for (const [k, v] of Object.entries(s.expenseByCategory)) t.expenseByCategory[k] = (t.expenseByCategory[k] ?? 0) + v;
    for (const [k, v] of Object.entries(s.otherByCategory)) t.otherByCategory[k] = (t.otherByCategory[k] ?? 0) + v;
  }
  return t;
}

// ---------------------------------------------------------------------
// PARTE 3 — Limite vigente e alertas
// ---------------------------------------------------------------------
export function pickLimit(limits: RevenueLimit[], regime: TaxRegime | null, refISO: string) {
  if (!regime || regime === "outro") return null;
  return (
    limits
      .filter((l) => l.regime === regime && l.valid_from <= refISO)
      .sort((a, b) => (a.valid_from < b.valid_from ? 1 : -1))[0] ?? null
  );
}

/** Limite do ano civil (no ano de início: valor por mês × meses de atividade, contando o mês de início) */
export function limitForYear(limit: RevenueLimit, activityStart: string | null, year: number) {
  if (limit.basis === "annual" && limit.first_year_monthly && activityStart && Number(activityStart.slice(0, 4)) === year) {
    const months = 12 - Number(activityStart.slice(5, 7)) + 1;
    return { value: Math.min(r2(limit.first_year_monthly * months), limit.annual_limit), proportional: true, months };
  }
  return { value: limit.annual_limit, proportional: false, months: 12 };
}

export type Alert = { tone: "info" | "warn" | "danger"; text: string };

const NAME: Record<Exclude<TaxRegime, "outro">, string> = {
  nanoempreendedor: "do nanoempreendedor",
  mei: "do MEI",
  simples: "do Simples",
};

export function usageAlert(regime: Exclude<TaxRegime, "outro">, pct: number): Alert | null {
  if (pct >= 120) {
    return {
      tone: "danger",
      text: regime === "mei"
        ? "Acima de 20% do limite muda o regime — fale com seu contador."
        : `Mais de 20% acima do limite ${NAME[regime]} — fale com seu contador.`,
    };
  }
  if (pct >= 100) {
    return {
      tone: "danger",
      text: regime === "mei"
        ? "Você passou do limite do MEI. Até 20% acima há regras específicas — fale com seu contador."
        : `Você passou do limite ${NAME[regime]} — fale com seu contador.`,
    };
  }
  if (pct >= 80) {
    return { tone: "warn", text: `Você já usou ${Math.floor(pct)}% do limite. Planeje os próximos meses com seu contador.` };
  }
  return null;
}

export function sublimitAlert(limit: RevenueLimit, base: number): Alert | null {
  if (!limit.sublimit || base < limit.sublimit) return null;
  return {
    tone: "info",
    text: `A receita dos últimos 12 meses atingiu o sublimite de ${brl(limit.sublimit)}: ICMS/ISS passam a ser recolhidos fora do Simples — fale com seu contador.`,
  };
}

// ---------------------------------------------------------------------
// PARTE 4 — Relatório para o contador
// rows precisa cobrir 12 meses antes de `from` (RBT12 do primeiro mês).
// RBT12 do mês M = soma da base dos 12 meses anteriores a M.
// ---------------------------------------------------------------------
export type AccountantReport = {
  from: string;
  to: string;
  months: MonthSummary[];
  rbt12: Record<string, number>;
  totals: MonthSummary;
  years: { year: string; summary: MonthSummary }[];
  usesPartner: boolean;
};

export function buildReport(rows: BillingRow[], from: string, to: string, usesPartner: boolean): AccountantReport {
  const all = summarize(rows, monthRange(addMonthsKey(from, -12), to), usesPartner);
  const byKey = new Map(all.map((s) => [s.month, s]));
  const months = all.filter((s) => s.month >= from);

  const rbt12: Record<string, number> = {};
  for (const s of months) {
    let t = 0;
    for (let i = 1; i <= 12; i++) t += byKey.get(addMonthsKey(s.month, -i))?.base ?? 0;
    rbt12[s.month] = r2(t);
  }

  const yearKeys = Array.from(new Set(months.map((s) => s.month.slice(0, 4))));
  return {
    from,
    to,
    months,
    rbt12,
    totals: sumMonths(months),
    years: yearKeys.map((y) => ({ year: y, summary: sumMonths(months.filter((s) => s.month.startsWith(y)), y) })),
    usesPartner,
  };
}

export const METHODS = Object.keys(METHOD_LABEL) as CashMethod[];

/** Período do relatório (?de=YYYY-MM&ate=YYYY-MM). Padrão: ano civil atual; no máx. 24 meses. */
export function parsePeriod(params: { de?: string; ate?: string }, todayISO: string) {
  const year = todayISO.slice(0, 4);
  const ok = (v?: string) => (v && /^\d{4}-(0[1-9]|1[0-2])$/.test(v) ? v : null);
  let from = ok(params.de) ?? `${year}-01`;
  let to = ok(params.ate) ?? `${year}-12`;
  if (from > to) [from, to] = [to, from];
  if (monthRange(from, to).length > 24) to = addMonthsKey(from, 23);
  return { from, to };
}

/** CNPJ só dígitos → 00.000.000/0000-00 */
export const formatCnpj = (d: string | null) =>
  d && d.length === 14 ? `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}` : "";
