import Link from "next/link";
import { addMonths, endOfMonth, format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ArrowDownRight, ArrowUpRight, ChevronLeft, ChevronRight } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getAdminContext } from "@/lib/admin";
import { getPlanContext } from "@/lib/plan";
import { LockedFeature } from "@/components/admin/locked-feature";
import { todayISO } from "@/lib/dates";
import { brl } from "@/lib/format";
import { CATEGORY_LABEL, METHOD_LABEL, type CashCategory, type CashMethod } from "@/lib/cash";
import { Button } from "@/components/ui/button";
import { RevenueChart } from "@/components/admin/financeiro/revenue-chart";
import { CashEntryDialog } from "@/components/admin/financeiro/cash-entry-dialog";
import { DeleteEntryButton } from "@/components/admin/financeiro/delete-entry-button";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

type Props = { searchParams: { mes?: string } };

type Entry = {
  id: string;
  kind: "income" | "expense";
  category: CashCategory;
  method: CashMethod;
  amount: number;
  description: string | null;
  entry_date: string;
  booking_id: string | null;
};

// ---------------------------------------------------------------------
// PARTE 1 — Dados
// ---------------------------------------------------------------------
export default async function FinanceiroPage({ searchParams }: Props) {
  const { business } = await getAdminContext();
  const plan = await getPlanContext(business.id);
  if (plan.tier === "gratis") return <LockedFeature feature="financeiro" />;

  const supabase = createClient();

  const today = todayISO();
  const month = /^\d{4}-\d{2}$/.test(searchParams.mes ?? "") ? searchParams.mes! : today.slice(0, 7);
  const monthDate = parseISO(`${month}-01`);
  const windowStart = format(addMonths(monthDate, -5), "yyyy-MM-dd");
  const monthStart = `${month}-01`;
  const monthEnd = format(endOfMonth(monthDate), "yyyy-MM-dd");
  const prev = format(addMonths(monthDate, -1), "yyyy-MM");
  const next = format(addMonths(monthDate, 1), "yyyy-MM");
  const isCurrent = month === today.slice(0, 7);

  const { data } = await supabase
    .from("cash_entries")
    .select("id, kind, category, method, amount, description, entry_date, booking_id")
    .eq("business_id", business.id)
    .gte("entry_date", windowStart)
    .lte("entry_date", monthEnd)
    .order("entry_date", { ascending: false })
    .order("created_at", { ascending: false });

  const all = ((data ?? []) as Entry[]).map((e) => ({ ...e, amount: Number(e.amount) }));
  const entries = all.filter((e) => e.entry_date >= monthStart);
  const sum = (list: Entry[]) => list.reduce((s, e) => s + e.amount, 0);

  const income = sum(entries.filter((e) => e.kind === "income"));
  const expense = sum(entries.filter((e) => e.kind === "expense"));

  // gráfico: últimos 6 meses
  const chart = Array.from({ length: 6 }, (_, i) => {
    const d = addMonths(monthDate, i - 5);
    const key = format(d, "yyyy-MM");
    const list = all.filter((e) => e.entry_date.startsWith(key));
    return {
      label: format(d, "MMM", { locale: ptBR }).replace(".", ""),
      entradas: Math.round(sum(list.filter((e) => e.kind === "income"))),
      saidas: Math.round(sum(list.filter((e) => e.kind === "expense"))),
    };
  });

  // entradas por forma de pagamento
  const byMethod = (Object.keys(METHOD_LABEL) as CashMethod[])
    .map((m) => ({ method: m, total: sum(entries.filter((e) => e.kind === "income" && e.method === m)) }))
    .filter((x) => x.total > 0)
    .sort((a, b) => b.total - a.total);

  // -------------------------------------------------------------------
  // PARTE 2 — Página
  // -------------------------------------------------------------------
  return (
    <main className="mx-auto max-w-6xl space-y-6 p-4 md:p-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl md:text-4xl">Financeiro</h1>
          <div className="mt-3 flex items-center gap-1">
            <Button asChild variant="outline" size="icon" className="h-10 w-10">
              <Link href={`/admin/financeiro?mes=${prev}`} aria-label="Mês anterior" data-testid="btn-mes-anterior">
                <ChevronLeft className="h-5 w-5" />
              </Link>
            </Button>
            <p className="min-w-[150px] text-center font-semibold capitalize">
              {format(monthDate, "MMMM 'de' yyyy", { locale: ptBR })}
            </p>
            <Button asChild variant="outline" size="icon" className="h-10 w-10">
              <Link href={`/admin/financeiro?mes=${next}`} aria-label="Próximo mês" data-testid="btn-mes-seguinte">
                <ChevronRight className="h-5 w-5" />
              </Link>
            </Button>
            {!isCurrent && (
              <Button asChild variant="ghost" className="h-10">
                <Link href="/admin/financeiro">Mês atual</Link>
              </Button>
            )}
          </div>
        </div>
        <CashEntryDialog defaultDate={isCurrent ? today : monthStart} />
      </header>

      {/* Resumo */}
      <section className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border bg-card p-4 md:p-5">
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <ArrowUpRight className="h-4 w-4 text-green-700" /> Entradas
          </p>
          <p className="mt-2 font-heading text-2xl md:text-3xl">{brl(income)}</p>
        </div>
        <div className="rounded-2xl border bg-card p-4 md:p-5">
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <ArrowDownRight className="h-4 w-4 text-red-700" /> Saídas
          </p>
          <p className="mt-2 font-heading text-2xl md:text-3xl">{brl(expense)}</p>
        </div>
        <div className="col-span-2 rounded-2xl border bg-foreground p-4 text-background md:p-5 lg:col-span-1">
          <p className="text-sm text-stone-300">Saldo do mês</p>
          <p className={cn("mt-2 font-heading text-2xl md:text-3xl", income - expense < 0 && "text-red-300")}>
            {brl(income - expense)}
          </p>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        <section className="rounded-2xl border bg-card p-5">
          <h2 className="mb-4 font-sans text-base font-semibold">Últimos 6 meses</h2>
          <RevenueChart data={chart} />
        </section>

        <section className="rounded-2xl border bg-card p-5">
          <h2 className="font-sans text-base font-semibold">Entradas por forma de pagamento</h2>
          {byMethod.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">Nenhuma entrada neste mês.</p>
          ) : (
            <ul className="mt-4 space-y-4">
              {byMethod.map((m) => {
                const pct = Math.round((m.total / income) * 100);
                return (
                  <li key={m.method}>
                    <div className="flex justify-between text-sm">
                      <span>{METHOD_LABEL[m.method]}</span>
                      <span className="font-semibold">{brl(m.total)}</span>
                    </div>
                    <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-secondary">
                      <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{pct}% das entradas</p>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      {/* Lançamentos */}
      <section className="rounded-2xl border bg-card">
        <h2 className="border-b p-5 font-sans text-base font-semibold">
          Lançamentos do mês <span className="font-normal text-muted-foreground">({entries.length})</span>
        </h2>
        {entries.length === 0 ? (
          <p className="p-8 text-center text-muted-foreground">Nenhum lançamento neste mês.</p>
        ) : (
          <ul className="divide-y">
            {entries.map((e) => (
              <li key={e.id} className="flex items-center gap-3 px-4 py-3 md:px-5" data-testid={`lancamento-${e.id}`}>
                <span
                  className={cn(
                    "grid h-9 w-9 shrink-0 place-items-center rounded-full",
                    e.kind === "income" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"
                  )}
                >
                  {e.kind === "income" ? <ArrowUpRight className="h-4 w-4" /> : <ArrowDownRight className="h-4 w-4" />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{e.description ?? CATEGORY_LABEL[e.category]}</p>
                  <p className="text-xs text-muted-foreground">
                    {e.entry_date.split("-").reverse().slice(0, 2).join("/")} · {CATEGORY_LABEL[e.category]} · {METHOD_LABEL[e.method]}
                    {e.booking_id && " · da agenda"}
                  </p>
                </div>
                <p className={cn("shrink-0 text-sm font-semibold", e.kind === "income" ? "text-green-700" : "text-red-700")}>
                  {e.kind === "income" ? "+" : "−"} {brl(e.amount)}
                </p>
                <DeleteEntryButton id={e.id} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
