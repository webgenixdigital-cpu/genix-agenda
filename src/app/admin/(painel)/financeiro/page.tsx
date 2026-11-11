import Link from "next/link";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ArrowDownRight, ArrowUpRight, CalendarRange } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireRoles } from "@/lib/admin";
import { getPlanContext } from "@/lib/plan";
import { LockedFeature } from "@/components/admin/locked-feature";
import { todayInZone } from "@/lib/dates";
import { brl } from "@/lib/format";
import { CATEGORY_LABEL, METHOD_LABEL, type CashMethod } from "@/lib/cash";
import { entryPeople, loadCashEntries, loadCashMonthly, loadCashSummary } from "@/lib/cash-data";
import { PAGE_SIZE, PRESETS, TIPOS, cashHref, parseCashFilters, presetRange } from "@/lib/cash-period";
import { Button } from "@/components/ui/button";
import { RevenueChart } from "@/components/admin/financeiro/revenue-chart";
import { CashEntryDialog } from "@/components/admin/financeiro/cash-entry-dialog";
import { DeleteEntryButton } from "@/components/admin/financeiro/delete-entry-button";
import { FinanceTabs } from "@/components/admin/financeiro/finance-tabs";
import { CashFilterBar } from "@/components/admin/financeiro/cash-filter-bar";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

type Props = { searchParams: { de?: string; ate?: string; tipo?: string; limite?: string } };

const METHODS = Object.keys(METHOD_LABEL) as CashMethod[];

// ---------------------------------------------------------------------
// PARTE 1 — Dados
// ---------------------------------------------------------------------
export default async function FinanceiroPage({ searchParams }: Props) {
  const { business } = await requireRoles(["owner", "viewer"]);
  const plan = await getPlanContext(business.id);
  if (plan.tier === "gratis") return <LockedFeature feature="financeiro" />;

  const supabase = createClient();
  const tz = business.timezone || "America/Sao_Paulo";
  const today = todayInZone(tz);
  const f = parseCashFilters(searchParams, today);
  const [rows, summary, monthly] = await Promise.all([
    loadCashEntries(supabase, business.id, f, f.limite),
    loadCashSummary(supabase, business.id, f),
    loadCashMonthly(supabase, business.id, f.ate),
  ]);
  const chart =
    monthly?.map((m) => ({
      label: format(parseISO(`${m.month}-01`), "MMM", { locale: ptBR }).replace(".", ""),
      entradas: Math.round(m.income),
      saidas: Math.round(m.expense),
    })) ?? null;
  const hasMore = rows.length > f.limite;
  const entries = rows.slice(0, f.limite);
  const balance = summary.income - summary.expense;
  const methodRows = METHODS.map((m) => ({ method: m, ...(summary.byMethod[m] ?? { income: 0, expense: 0 }) })).filter(
    (m) => m.income > 0 || m.expense > 0
  );

  const time = new Intl.DateTimeFormat("pt-BR", { timeZone: tz, hour: "2-digit", minute: "2-digit" });
  const shortDate = (iso: string) => iso.split("-").reverse().join("/");
  const periodLabel = f.de === f.ate ? shortDate(f.de) : `${shortDate(f.de)} a ${shortDate(f.ate)}`;
  const dialogDate = today >= f.de && today <= f.ate ? today : f.ate;

  // -------------------------------------------------------------------
  // PARTE 2 — Página
  // -------------------------------------------------------------------
  return (
    <main className="mx-auto max-w-6xl space-y-6 p-4 md:space-y-8 md:p-8">
      <header className="flex flex-col items-center gap-4 text-center">
        <div>
          <h1 className="text-3xl md:text-4xl">Financeiro</h1>
          <div className="mt-3">
            <FinanceTabs active="caixa" />
          </div>
        </div>
        <CashEntryDialog defaultDate={dialogDate} />
      </header>

      <CashFilterBar
        presets={PRESETS.map((p) => ({
          key: p.key,
          label: p.label,
          // "Hoje" sem datas na URL (padrão); os outros atalhos gravam de/ate do momento
          href: cashHref(f, p.key === "hoje" ? { de: null, ate: null } : presetRange(p.key, today)),
          active: f.preset === p.key,
        }))}
        periodActive={!f.preset}
        tipos={[
          { key: "todos", label: "Todos", href: cashHref(f, { tipo: null }), active: !f.tipo },
          ...TIPOS.map((t) => ({ key: t.key, label: t.label, href: cashHref(f, { tipo: t.key }), active: f.tipo === t.key })),
        ]}
        csvHref={`/admin/caixa/csv?${cashHref(f).split("?")[1] ?? ""}`}
        de={f.de}
        ate={f.ate}
        tipo={f.tipo}
      />

      {f.notice && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900" role="status">
          {f.notice}
        </p>
      )}

      {/* Resumo do período */}
      <section aria-label={`Resumo de ${periodLabel}`} className="space-y-4">
        <p className="text-sm text-muted-foreground" data-testid="caixa-periodo">
          <CalendarRange className="mr-1.5 inline h-4 w-4 align-[-3px]" />
          {periodLabel}
          {f.tipo && ` · só ${TIPOS.find((x) => x.key === f.tipo)?.label.toLowerCase()}`}
        </p>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
          <div className="rounded-2xl border bg-card p-4 md:p-5">
            <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <ArrowUpRight className="h-4 w-4 text-green-700" /> Entradas
            </p>
            <p className="mt-2 break-words font-heading text-2xl md:text-3xl" data-testid="caixa-entradas">
              {brl(summary.income)}
            </p>
          </div>
          <div className="rounded-2xl border bg-card p-4 md:p-5">
            <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <ArrowDownRight className="h-4 w-4 text-red-700" /> Saídas
            </p>
            <p className="mt-2 break-words font-heading text-2xl md:text-3xl" data-testid="caixa-saidas">
              {brl(summary.expense)}
            </p>
          </div>
          <div className="col-span-2 rounded-2xl border bg-foreground p-4 text-background md:p-5 lg:col-span-1">
            <p className="text-sm text-stone-300">Saldo do período</p>
            <p
              className={cn("mt-2 break-words font-heading text-2xl md:text-3xl", balance < 0 && "text-red-300")}
              data-testid="caixa-saldo"
            >
              {brl(balance)}
            </p>
          </div>
        </div>
      </section>

      <div className={cn("grid gap-6", chart && "lg:grid-cols-[1fr_320px]")}>
        {chart && (
          <section className="rounded-2xl border bg-card p-5">
            <h2 className="mb-4 font-sans text-base font-semibold">Últimos 6 meses</h2>
            <RevenueChart data={chart} />
          </section>
        )}

        <section className="rounded-2xl border bg-card p-5">
          <h2 className="font-sans text-base font-semibold">Por forma de pagamento</h2>
          {methodRows.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">Nenhum lançamento no período.</p>
          ) : (
            <ul className="mt-4 space-y-4" data-testid="caixa-por-forma">
              {methodRows.map((m) => {
                const pct = summary.income > 0 ? Math.round((m.income / summary.income) * 100) : 0;
                return (
                  <li key={m.method}>
                    <div className="flex justify-between gap-3 text-sm">
                      <span>{METHOD_LABEL[m.method]}</span>
                      <span className="font-semibold">{brl(m.income)}</span>
                    </div>
                    {m.income > 0 && (
                      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-secondary">
                        <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
                      </div>
                    )}
                    <p className="mt-1 text-xs text-muted-foreground">
                      {m.income > 0 ? `${pct}% das entradas` : "sem entradas"}
                      {m.expense > 0 && ` · saídas ${brl(m.expense)}`}
                    </p>
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
          Lançamentos do período <span className="font-normal text-muted-foreground">({summary.count})</span>
        </h2>
        {entries.length === 0 ? (
          <p className="p-8 text-center text-muted-foreground">Nenhum lançamento no período.</p>
        ) : (
          <ul className="divide-y">
            {entries.map((e) => {
              const { customer, professional } = entryPeople(e);
              return (
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
                    <p className="break-words text-xs text-muted-foreground">
                      {shortDate(e.entry_date).slice(0, 5)} · {time.format(new Date(e.created_at))} · {METHOD_LABEL[e.method]} ·{" "}
                      {CATEGORY_LABEL[e.category]}
                    </p>
                    {(customer || professional) && (
                      <p className="break-words text-xs text-muted-foreground">
                        {customer}
                        {customer && professional && " · "}
                        {professional && `com ${professional}`}
                      </p>
                    )}
                  </div>
                  <p className={cn("shrink-0 text-sm font-semibold", e.kind === "income" ? "text-green-700" : "text-red-700")}>
                    {e.kind === "income" ? "+" : "−"} {brl(e.amount)}
                  </p>
                  <DeleteEntryButton id={e.id} />
                </li>
              );
            })}
          </ul>
        )}
        {hasMore && (
          <div className="border-t p-4 text-center">
            <Button asChild variant="outline" className="h-11">
              <Link href={cashHref(f, { limite: f.limite + PAGE_SIZE })} scroll={false} data-testid="btn-caixa-carregar-mais">
                Carregar mais
              </Link>
            </Button>
            <p className="mt-2 text-xs text-muted-foreground">
              Mostrando {entries.length} de {summary.count}
            </p>
          </div>
        )}
      </section>
    </main>
  );
}
