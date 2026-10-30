import Link from "next/link";
import { FileText, Settings } from "lucide-react";
import { requireRoles } from "@/lib/admin";
import { getPlanContext } from "@/lib/plan";
import { todayISO } from "@/lib/dates";
import { brl } from "@/lib/format";
import {
  NOTES, REGIME_LABEL, addMonthsKey, baseLabel, categoryLabel, lastDayOf, limitForYear, monthLabel, monthRange,
  pickLimit, sublimitAlert, sumMonths, summarize, usageAlert,
} from "@/lib/faturamento";
import { loadBilling, loadFiscal, loadLimits } from "@/lib/faturamento-data";
import { LockedFeature } from "@/components/admin/locked-feature";
import { FinanceTabs } from "@/components/admin/financeiro/finance-tabs";
import { AlertBox, ReportNotes } from "@/components/admin/financeiro/billing-notes";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------
// PARTE 1 — Dados (mês atual, ano civil e últimos 12 meses)
// ---------------------------------------------------------------------
export default async function FaturamentoPage() {
  const { business } = await requireRoles(["owner", "viewer"]);
  const plan = await getPlanContext(business.id);
  if (plan.tier === "gratis") return <LockedFeature feature="faturamento" />;

  const today = todayISO();
  const current = today.slice(0, 7);
  const year = Number(current.slice(0, 4));
  const from = addMonthsKey(current, -11);

  const [fiscal, limits, rows] = await Promise.all([
    loadFiscal(business.id),
    loadLimits(),
    loadBilling(business.id, `${from}-01`, lastDayOf(current)),
  ]);

  const usesPartner = fiscal.partner_salon;
  const months = summarize(rows, monthRange(from, current), usesPartner);
  const month = months[months.length - 1];
  const ytd = sumMonths(months.filter((m) => m.month.startsWith(String(year))));
  const last12 = sumMonths(months);

  const limit = pickLimit(limits, fiscal.regime, today);
  const regime = fiscal.regime && fiscal.regime !== "outro" ? fiscal.regime : null;
  const cap = limit ? (limit.basis === "annual" ? limitForYear(limit, fiscal.activity_start, year) : { value: limit.annual_limit, proportional: false, months: 12 }) : null;
  const used = limit?.basis === "rbt12" ? last12.base : ytd.base;
  const pct = cap ? (used / cap.value) * 100 : 0;
  const alert = regime && cap ? usageAlert(regime, pct) : null;
  const subAlert = limit?.basis === "rbt12" ? sublimitAlert(limit, used) : null;

  // -------------------------------------------------------------------
  // PARTE 2 — Página
  // -------------------------------------------------------------------
  return (
    <main className="mx-auto max-w-6xl space-y-6 p-4 md:p-8">
      <header className="space-y-3">
        <h1 className="text-3xl md:text-4xl">Financeiro</h1>
        <FinanceTabs active="faturamento" />
      </header>

      <ReportNotes />

      {!fiscal.regime && (
        <section className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-dashed bg-card p-5" data-testid="cta-enquadramento">
          <div>
            <p className="font-semibold">Defina o enquadramento do seu espaço</p>
            <p className="text-sm text-muted-foreground">Com ele, mostramos o limite de faturamento e os alertas.</p>
          </div>
          <Button asChild className="h-11" data-testid="btn-definir-enquadramento">
            <Link href="/admin/configuracoes#enquadramento">
              <Settings className="mr-1.5 h-4 w-4" /> Definir enquadramento
            </Link>
          </Button>
        </section>
      )}

      {/* Receita */}
      <section className="grid gap-4 sm:grid-cols-3">
        <Stat label={`Mês atual (${monthLabel(current)})`} value={month.base} total={usesPartner ? month.income : null} testId="faturamento-mes" />
        <Stat label={`Ano de ${year}`} value={ytd.base} total={usesPartner ? ytd.income : null} testId="faturamento-ano" />
        <Stat label="Últimos 12 meses" value={last12.base} total={usesPartner ? last12.income : null} testId="faturamento-12-meses" />
      </section>
      <p className="-mt-3 text-xs text-muted-foreground" data-testid="base-usada">{baseLabel(usesPartner)}.</p>

      {/* Limite */}
      <section className="space-y-4 rounded-2xl border bg-card p-5 md:p-6" data-testid="painel-limite">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-sans text-base font-semibold">
            Limite {fiscal.regime ? `· ${REGIME_LABEL[fiscal.regime]}` : ""}
          </h2>
          {cap && (
            <p className="text-sm text-muted-foreground">
              {limit?.basis === "rbt12" ? "Receita dos últimos 12 meses (inclui o mês atual)" : `Receita do ano de ${year}`}
            </p>
          )}
        </div>

        {!fiscal.regime ? (
          <p className="text-sm text-muted-foreground">Sem enquadramento definido.</p>
        ) : !cap ? (
          <p className="text-sm text-muted-foreground">
            {fiscal.regime === "outro" ? "Sem limite acompanhado para este enquadramento." : "Limite ainda não cadastrado pela Genix."}
          </p>
        ) : (
          <>
            <div>
              <div className="flex flex-wrap justify-between gap-2 text-sm">
                <span>
                  <strong className="font-heading text-2xl">{brl(used)}</strong> de {brl(cap.value)}
                </span>
                <span className="font-semibold" data-testid="limite-percentual">{pct.toFixed(1).replace(".", ",")}%</span>
              </div>
              <div className="mt-2 h-3 overflow-hidden rounded-full bg-secondary">
                <div
                  className={cn("h-full rounded-full", pct >= 100 ? "bg-red-600" : pct >= 80 ? "bg-amber-500" : "bg-primary")}
                  style={{ width: `${Math.min(pct, 100)}%` }}
                />
              </div>
              {cap.proportional && limit?.first_year_monthly && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Ano de início: {brl(limit.first_year_monthly)} × {cap.months} {cap.months === 1 ? "mês" : "meses"} de atividade (contando o mês de início).
                </p>
              )}
              {limit?.sublimit && (
                <p className="mt-1 text-xs text-muted-foreground">Sublimite de ICMS/ISS: {brl(limit.sublimit)}.</p>
              )}
            </div>
            {alert && <AlertBox alert={alert} testId="alerta-limite" />}
            {subAlert && <AlertBox alert={subAlert} testId="alerta-sublimite" />}
          </>
        )}
      </section>

      {/* Salão-parceiro */}
      {usesPartner && (
        <section className="space-y-3 rounded-2xl border bg-card p-5 md:p-6" data-testid="painel-salao-parceiro">
          <h2 className="font-sans text-base font-semibold">Salão-parceiro · ano de {year}</h2>
          <dl className="grid gap-3 sm:grid-cols-3">
            <Line label="Receita total" value={ytd.income} />
            <Line label="Repasse aos parceiros" value={ytd.partner} />
            <Line label="Cota-parte do salão" value={ytd.salonShare} strong />
          </dl>
          <p className="text-xs text-muted-foreground">
            Repasse pela comissão cadastrada de cada profissional parceiro (sessões de pacote: preço do pacote ÷ sessões × comissão).{" "}
            {NOTES.partner}
          </p>
        </section>
      )}

      {/* Outras entradas */}
      {ytd.other > 0 && (
        <section className="space-y-2 rounded-2xl border border-amber-300 bg-amber-50 p-5 text-amber-950" data-testid="painel-outras-entradas">
          <h2 className="font-sans text-base font-semibold">Outras entradas no ano: {brl(ytd.other)}</h2>
          <ul className="text-sm">
            {Object.entries(ytd.otherByCategory).map(([c, v]) => (
              <li key={c}>{categoryLabel(c)}: {brl(v)}</li>
            ))}
          </ul>
          <p className="text-sm">{NOTES.otherIncome} Elas continuam somadas na receita acima.</p>
        </section>
      )}

      <Button asChild variant="outline" className="h-11" data-testid="btn-ir-relatorio-contador">
        <Link href="/admin/financeiro/contador">
          <FileText className="mr-1.5 h-4 w-4" /> Relatório para o contador
        </Link>
      </Button>
    </main>
  );
}

function Stat({ label, value, total, testId }: { label: string; value: number; total: number | null; testId: string }) {
  return (
    <div className="rounded-2xl border bg-card p-4 md:p-5" data-testid={testId}>
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-2 font-heading text-2xl md:text-3xl">{brl(value)}</p>
      {total !== null && <p className="mt-1 text-xs text-muted-foreground">Receita total: {brl(total)}</p>}
    </div>
  );
}

function Line({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className="rounded-xl bg-secondary/60 p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn("mt-1 text-lg", strong && "font-semibold")}>{brl(value)}</dd>
    </div>
  );
}
