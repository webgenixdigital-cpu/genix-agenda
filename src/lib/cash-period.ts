// Filtros do Caixa (Financeiro): período, forma de pagamento e tipo, lidos da URL
// (?de=&ate=&forma=&tipo=). Datas "yyyy-mm-dd" no fuso do espaço.
import { addDaysISO, mondayOf } from "@/lib/dates";
import type { CashMethod } from "@/lib/cash";

export type PeriodPreset = "hoje" | "ontem" | "semana" | "semana_passada" | "mes" | "mes_passado";
export type CashForma = "pix" | "cartao" | "dinheiro";
export type CashTipo = "entrada" | "saida";

export const PRESETS: { key: PeriodPreset; label: string }[] = [
  { key: "hoje", label: "Hoje" },
  { key: "ontem", label: "Ontem" },
  { key: "semana", label: "Esta semana" },
  { key: "semana_passada", label: "Semana passada" },
  { key: "mes", label: "Este mês" },
  { key: "mes_passado", label: "Mês passado" },
];

export const FORMAS: { key: CashForma; label: string; methods: CashMethod[] }[] = [
  { key: "pix", label: "Pix", methods: ["pix"] },
  { key: "cartao", label: "Cartão", methods: ["credito", "debito"] },
  { key: "dinheiro", label: "Dinheiro", methods: ["dinheiro"] },
];

export const TIPOS: { key: CashTipo; label: string; kind: "income" | "expense" }[] = [
  { key: "entrada", label: "Entradas", kind: "income" },
  { key: "saida", label: "Saídas", kind: "expense" },
];

/** Período máximo do filtro "Período" (1 ano) */
export const MAX_PERIOD_DAYS = 366;
export const PAGE_SIZE = 100;

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const isRealISO = (v: string | undefined): v is string => {
  if (!v || !ISO.test(v)) return false;
  const d = new Date(`${v}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
};

const lastDayOfMonth = (iso: string) => {
  const [y, m] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};

export function presetRange(preset: PeriodPreset, today: string): { de: string; ate: string } {
  switch (preset) {
    case "ontem": {
      const d = addDaysISO(today, -1);
      return { de: d, ate: d };
    }
    case "semana":
      return { de: mondayOf(today), ate: today };
    case "semana_passada": {
      const start = addDaysISO(mondayOf(today), -7);
      return { de: start, ate: addDaysISO(start, 6) };
    }
    case "mes":
      return { de: `${today.slice(0, 8)}01`, ate: today };
    case "mes_passado": {
      const start = `${addDaysISO(`${today.slice(0, 8)}01`, -1).slice(0, 8)}01`;
      return { de: start, ate: lastDayOfMonth(start) };
    }
    default:
      return { de: today, ate: today };
  }
}

const daysBetween = (a: string, b: string) =>
  Math.round((new Date(`${b}T12:00:00Z`).getTime() - new Date(`${a}T12:00:00Z`).getTime()) / 86_400_000);

export type CashFilters = {
  de: string;
  ate: string;
  /** atalho que bate com o período; null = "Período" personalizado */
  preset: PeriodPreset | null;
  forma: CashForma | null;
  tipo: CashTipo | null;
  limite: number;
  /** aviso amigável quando a URL trazia algo inválido e foi corrigido */
  notice: string | null;
};

export function parseCashFilters(
  sp: { de?: string; ate?: string; forma?: string; tipo?: string; limite?: string },
  today: string
): CashFilters {
  let notice: string | null = null;
  let de = today;
  let ate = today;

  if (sp.de || sp.ate) {
    const okDe = isRealISO(sp.de);
    const okAte = isRealISO(sp.ate);
    if (okDe || okAte) {
      de = okDe ? sp.de! : sp.ate!;
      ate = okAte ? sp.ate! : sp.de!;
      if (de > ate) [de, ate] = [ate, de];
      if (daysBetween(de, ate) >= MAX_PERIOD_DAYS) {
        de = addDaysISO(ate, -(MAX_PERIOD_DAYS - 1));
        notice = "O período máximo é de 1 ano. Mostrando os 12 meses até a data final.";
      }
    } else notice = "Datas inválidas no link. Mostrando hoje.";
  }

  const preset = PRESETS.find((p) => {
    const r = presetRange(p.key, today);
    return r.de === de && r.ate === ate;
  })?.key ?? null;

  const forma = FORMAS.some((f) => f.key === sp.forma) ? (sp.forma as CashForma) : null;
  const tipo = TIPOS.some((t) => t.key === sp.tipo) ? (sp.tipo as CashTipo) : null;
  const n = Number(sp.limite);
  const limite = Number.isInteger(n) && n > PAGE_SIZE ? Math.min(n, 5000) : PAGE_SIZE;

  return { de, ate, preset, forma, tipo, limite, notice };
}

/** Link do Caixa com os filtros atuais + mudanças (valor null tira o parâmetro) */
export function cashHref(f: Pick<CashFilters, "de" | "ate" | "forma" | "tipo">, change: Record<string, string | number | null> = {}) {
  const params: Record<string, string | number | null> = { de: f.de, ate: f.ate, forma: f.forma, tipo: f.tipo, ...change };
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== null && v !== "") q.set(k, String(v));
  const s = q.toString();
  return s ? `/admin/financeiro?${s}` : "/admin/financeiro";
}

export const formaMethods = (f: CashForma | null) => FORMAS.find((x) => x.key === f)?.methods ?? null;
export const tipoKind = (t: CashTipo | null) => TIPOS.find((x) => x.key === t)?.kind ?? null;
