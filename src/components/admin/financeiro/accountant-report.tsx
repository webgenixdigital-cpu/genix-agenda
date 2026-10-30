// Relatório para o contador: usado na tela (Financeiro › Contador) e na página de impressão
import { brl } from "@/lib/format";
import { METHOD_LABEL } from "@/lib/cash";
import {
  METHODS, NOTES, REGIME_LABEL, baseLabel, categoryLabel, formatCnpj, monthLabel,
  type AccountantReport as Report, type FiscalProfile,
} from "@/lib/faturamento";
import { ReportNotes } from "@/components/admin/financeiro/billing-notes";

type Props = { businessName: string; fiscal: FiscalProfile; report: Report; generatedAt: string };

const th = "px-2 py-2 text-left font-semibold";
const td = "px-2 py-1.5 text-right tabular-nums";

export function AccountantReport({ businessName, fiscal, report, generatedAt }: Props) {
  const { months, totals, rbt12, usesPartner } = report;
  const isSimples = fiscal.regime === "simples";
  const expenses = Object.entries(totals.expenseByCategory).sort((a, b) => b[1] - a[1]);
  const others = Object.entries(totals.otherByCategory).sort((a, b) => b[1] - a[1]);

  return (
    <article className="space-y-6 text-sm" data-testid="relatorio-contador">
      {/* Dados do espaço */}
      <section className="rounded-2xl border bg-card p-5 print:rounded-none print:border-0 print:p-0">
        <h2 className="text-2xl">Relatório para o contador</h2>
        <dl className="mt-3 grid gap-x-6 gap-y-1 sm:grid-cols-2">
          <Info label="Espaço" value={businessName} />
          <Info label="CNPJ" value={formatCnpj(fiscal.cnpj) || "Não informado"} />
          <Info label="Enquadramento" value={fiscal.regime ? REGIME_LABEL[fiscal.regime] : "Não definido"} />
          <Info label="Período" value={`${monthLabel(report.from)} a ${monthLabel(report.to)}`} />
          {fiscal.activity_start && <Info label="Início das atividades" value={fiscal.activity_start.split("-").reverse().join("/")} />}
          <Info label="Gerado em" value={generatedAt} />
        </dl>
        <ReportNotes className="mt-4 print:bg-transparent print:p-0" />
        <p className="mt-2 text-xs text-muted-foreground">{baseLabel(usesPartner)}.</p>
      </section>

      {/* Receitas por mês */}
      <Block title="Receitas por mês">
        <Table>
          <thead>
            <tr className="border-b bg-secondary/60">
              <th className={th}>Mês</th>
              <th className={th}>Serviços e pacotes</th>
              <th className={th}>Produtos</th>
              <th className={th}>Outras entradas*</th>
              <th className={th}>Receita total</th>
              {usesPartner && <th className={th}>Repasse parceiros</th>}
              {usesPartner && <th className={th}>Cota-parte do salão</th>}
              {isSimples && <th className={th}>RBT12</th>}
            </tr>
          </thead>
          <tbody>
            {months.map((m) => (
              <tr key={m.month} className="border-b last:border-0">
                <td className="px-2 py-1.5 capitalize">{monthLabel(m.month)}</td>
                <td className={td}>{brl(m.services)}</td>
                <td className={td}>{brl(m.products)}</td>
                <td className={td}>{brl(m.other)}</td>
                <td className={`${td} font-semibold`}>{brl(m.income)}</td>
                {usesPartner && <td className={td}>{brl(m.partner)}</td>}
                {usesPartner && <td className={`${td} font-semibold`}>{brl(m.salonShare)}</td>}
                {isSimples && <td className={td}>{brl(rbt12[m.month])}</td>}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 font-semibold">
              <td className="px-2 py-2">Total</td>
              <td className={td}>{brl(totals.services)}</td>
              <td className={td}>{brl(totals.products)}</td>
              <td className={td}>{brl(totals.other)}</td>
              <td className={td}>{brl(totals.income)}</td>
              {usesPartner && <td className={td}>{brl(totals.partner)}</td>}
              {usesPartner && <td className={td}>{brl(totals.salonShare)}</td>}
              {isSimples && <td className={td}>—</td>}
            </tr>
          </tfoot>
        </Table>
        <p className="mt-2 text-xs text-muted-foreground" data-testid="nota-outras-entradas">
          * Outras entradas{others.length ? ` (${others.map(([c, v]) => `${categoryLabel(c)}: ${brl(v)}`).join("; ")})` : ""}: {NOTES.otherIncome} Continuam somadas na receita total.
        </p>
        {isSimples && (
          <p className="mt-1 text-xs text-muted-foreground">RBT12 = soma da base dos 12 meses anteriores ao mês.</p>
        )}
      </Block>

      {/* Receitas por forma de pagamento */}
      <Block title="Receitas por forma de pagamento">
        <Table>
          <thead>
            <tr className="border-b bg-secondary/60">
              <th className={th}>Mês</th>
              {METHODS.map((k) => <th key={k} className={th}>{METHOD_LABEL[k]}</th>)}
            </tr>
          </thead>
          <tbody>
            {months.map((m) => (
              <tr key={m.month} className="border-b last:border-0">
                <td className="px-2 py-1.5 capitalize">{monthLabel(m.month)}</td>
                {METHODS.map((k) => <td key={k} className={td}>{brl(m.byMethod[k])}</td>)}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 font-semibold">
              <td className="px-2 py-2">Total</td>
              {METHODS.map((k) => <td key={k} className={td}>{brl(totals.byMethod[k])}</td>)}
            </tr>
          </tfoot>
        </Table>
      </Block>

      {/* Despesas */}
      <Block title="Despesas por categoria">
        {expenses.length === 0 ? (
          <p className="text-muted-foreground">Nenhuma despesa lançada no período.</p>
        ) : (
          <Table>
            <tbody>
              {expenses.map(([c, v]) => (
                <tr key={c} className="border-b">
                  <td className="px-2 py-1.5">{categoryLabel(c)}</td>
                  <td className={td}>{brl(v)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 font-semibold">
                <td className="px-2 py-2">Total de despesas</td>
                <td className={td}>{brl(totals.expense)}</td>
              </tr>
            </tfoot>
          </Table>
        )}
        {usesPartner && <p className="mt-2 text-xs text-muted-foreground">{NOTES.commissionExpense}</p>}
      </Block>

      {/* Totais */}
      <Block title="Totais do período">
        <dl className="grid gap-3 sm:grid-cols-3">
          <Total label="Receita total" value={totals.income} />
          <Total label="Despesas" value={totals.expense} />
          <Total label="Entradas − despesas" value={totals.income - totals.expense} />
        </dl>
      </Block>

      {/* Salão-parceiro */}
      {usesPartner && (
        <Block title="Salão-parceiro (Lei 13.352/2016)">
          <dl className="grid gap-3 sm:grid-cols-3">
            <Total label="Receita total" value={totals.income} />
            <Total label="Repasse aos parceiros" value={totals.partner} />
            <Total label="Cota-parte do salão" value={totals.salonShare} />
          </dl>
          <p className="mt-2 text-xs text-muted-foreground">
            Repasse pela comissão cadastrada de cada profissional parceiro, congelada na conclusão do atendimento
            (atendimentos anteriores a este recurso usam a comissão atual). Sessão de pacote: preço do pacote ÷ sessões ×
            comissão, no mês da sessão. {NOTES.partner}
          </p>
        </Block>
      )}

      {/* Receita bruta anual */}
      <Block title={fiscal.regime === "mei" ? "Receita bruta anual (MEI — para a DASN-SIMEI)" : "Receita bruta anual"}>
        <Table>
          <thead>
            <tr className="border-b bg-secondary/60">
              <th className={th}>Ano</th>
              <th className={th}>Serviços e pacotes</th>
              <th className={th}>Revenda de produtos</th>
              <th className={th}>Outras entradas*</th>
              <th className={th}>{usesPartner ? "Cota-parte do salão" : "Receita bruta"}</th>
            </tr>
          </thead>
          <tbody>
            {report.years.map(({ year, summary }) => (
              <tr key={year} className="border-b last:border-0">
                <td className="px-2 py-1.5">{year}</td>
                <td className={td}>{brl(summary.services)}</td>
                <td className={td}>{brl(summary.products)}</td>
                <td className={td}>{brl(summary.other)}</td>
                <td className={`${td} font-semibold`}>{brl(summary.base)}</td>
              </tr>
            ))}
          </tbody>
        </Table>
        <p className="mt-2 text-xs text-muted-foreground">
          Só os meses do período escolhido. Para o ano inteiro, escolha de janeiro a dezembro.
        </p>
      </Block>
    </article>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <dt className="text-muted-foreground">{label}:</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border bg-card p-5 print:break-inside-avoid print:rounded-none print:border-0 print:p-0">
      <h3 className="mb-3 font-sans text-base font-semibold">{title}</h3>
      {children}
    </section>
  );
}

function Table({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto print:overflow-visible">
      <table className="w-full min-w-[520px] border-collapse text-xs sm:text-sm print:min-w-0 print:text-[10px]">{children}</table>
    </div>
  );
}

function Total({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-secondary/60 p-3 print:bg-transparent print:p-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-lg font-semibold">{brl(value)}</dd>
    </div>
  );
}
