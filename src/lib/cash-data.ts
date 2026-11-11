// Leitura do Caixa por período (página do Financeiro e planilha CSV). Só no servidor.
// A RLS de cash_entries ("matriz ve caixa") decide quem lê.
import type { createClient } from "@/lib/supabase/server";
import type { CashCategory, CashMethod } from "@/lib/cash";
import { tipoKind, type CashFilters } from "@/lib/cash-period";

type Db = ReturnType<typeof createClient>;
type One<T> = T | T[] | null;

export type CashEntryRow = {
  id: string;
  kind: "income" | "expense";
  category: CashCategory;
  method: CashMethod;
  amount: number;
  description: string | null;
  entry_date: string;
  created_at: string;
  booking_id: string | null;
  bookings?: One<{ customer_name: string | null; professionals: One<{ name: string | null }> }>;
  customer_packages?: One<{ customers: One<{ name: string | null }> }>;
};

export type CashSummary = {
  count: number;
  income: number;
  expense: number;
  byMethod: Partial<Record<CashMethod, { income: number; expense: number }>>;
};

type Filters = Pick<CashFilters, "de" | "ate" | "tipo">;

const COLUMNS = "id, kind, category, method, amount, description, entry_date, created_at, booking_id";
// cliente (do atendimento ou do pacote vendido) e profissional
const WITH_NAMES = `${COLUMNS}, bookings(customer_name, professionals(name)), customer_packages(customers(name))`;

const first = <T,>(v: One<T> | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);

/** Cliente e profissional do lançamento (null quando não há) */
export function entryPeople(e: CashEntryRow) {
  const bk = first(e.bookings);
  return {
    customer: bk?.customer_name ?? first(first(e.customer_packages)?.customers)?.name ?? null,
    professional: first(bk?.professionals)?.name ?? null,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyFilters(q: any, businessId: string, f: Filters) {
  const kind = tipoKind(f.tipo);
  let r = q.eq("business_id", businessId).gte("entry_date", f.de).lte("entry_date", f.ate);
  if (kind) r = r.eq("kind", kind);
  return r;
}

/** Lançamentos do período, do mais novo para o mais antigo (linhas from..to, inclusivas) */
async function page(db: Db, businessId: string, f: Filters, from: number, to: number, names: boolean) {
  return applyFilters(db.from("cash_entries").select(names ? WITH_NAMES : COLUMNS), businessId, f)
    .order("entry_date", { ascending: false })
    .order("created_at", { ascending: false })
    .order("id")
    .range(from, to) as Promise<{ data: CashEntryRow[] | null; error: { message: string } | null }>;
}

/** Até `limit` lançamentos (pede 1 a mais para saber se há "carregar mais") */
export async function loadCashEntries(db: Db, businessId: string, f: Filters, limit: number) {
  const out: CashEntryRow[] = [];
  let names = true;
  // o Supabase devolve no máximo 1000 linhas por chamada
  for (let from = 0; from <= limit; from += 1000) {
    const to = Math.min(from + 999, limit);
    let res = await page(db, businessId, f, from, to, names);
    if (res.error && names) {
      names = false; // embed indisponível: segue sem os nomes
      res = await page(db, businessId, f, from, to, false);
    }
    const rows = res.data ?? [];
    out.push(...rows.map((e) => ({ ...e, amount: Number(e.amount) })));
    if (rows.length < to - from + 1) break;
  }
  return out;
}

/** Totais do período (cash_period_summary, 43); sem a migration, soma em páginas */
export async function loadCashSummary(db: Db, businessId: string, f: Filters): Promise<CashSummary> {
  const { data, error } = await db.rpc("cash_period_summary", {
    p_business: businessId,
    p_from: f.de,
    p_to: f.ate,
    p_methods: null,
    p_kind: tipoKind(f.tipo),
  });
  if (!error && data) {
    const d = data as { count: number; income: number; expense: number; by_method: Record<string, { income: number; expense: number }> };
    const byMethod: CashSummary["byMethod"] = {};
    for (const [m, v] of Object.entries(d.by_method ?? {}))
      byMethod[m as CashMethod] = { income: Number(v?.income ?? 0), expense: Number(v?.expense ?? 0) };
    return { count: Number(d.count), income: Number(d.income), expense: Number(d.expense), byMethod };
  }
  const s: CashSummary = { count: 0, income: 0, expense: 0, byMethod: {} };
  for (let from = 0; from < 20_000; from += 1000) {
    const { data: rows } = await applyFilters(db.from("cash_entries").select("kind, method, amount"), businessId, f)
      .order("id")
      .range(from, from + 999);
    const list = (rows ?? []) as { kind: CashEntryRow["kind"]; method: CashMethod; amount: number }[];
    for (const r of list) {
      const v = Number(r.amount);
      const m = (s.byMethod[r.method] ??= { income: 0, expense: 0 });
      s.count++;
      if (r.kind === "income") {
        s.income += v;
        m.income += v;
      } else {
        s.expense += v;
        m.expense += v;
      }
    }
    if (list.length < 1000) break;
  }
  return s;
}

/** Entradas e saídas dos 6 meses até `until` (cash_monthly_totals, 43); null sem a migration */
export async function loadCashMonthly(db: Db, businessId: string, until: string) {
  const { data, error } = await db.rpc("cash_monthly_totals", { p_business: businessId, p_until: until, p_months: 6 });
  if (error || !data) return null;
  return (data as { month: string; income: number; expense: number }[]).map((m) => ({
    month: m.month,
    income: Number(m.income),
    expense: Number(m.expense),
  }));
}
