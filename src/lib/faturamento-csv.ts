// Planilha do relatório para o contador (CSV para o Excel pt-BR: ; e vírgula decimal)
import { CATEGORY_LABEL, METHOD_LABEL, type CashCategory, type CashMethod } from "@/lib/cash";
import {
  METHODS, NOTES, REGIME_LABEL, baseLabel, categoryLabel, formatCnpj, monthLabel,
  type AccountantReport, type FiscalProfile,
} from "@/lib/faturamento";

export type CsvEntry = {
  entry_date: string;
  kind: "income" | "expense";
  category: string;
  method: string;
  description: string | null;
  amount: number;
};

/** Texto: entre aspas e neutralizado contra fórmula (CSV injection) */
export function csvText(v: string | null | undefined) {
  let s = String(v ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

/** Número: 1234,56 (sem milhar), nunca vem de texto digitado */
export const csvNum = (v: number) => (Math.round(v * 100) / 100).toFixed(2).replace(".", ",");

export function buildCsv(input: {
  businessName: string;
  fiscal: FiscalProfile;
  report: AccountantReport;
  entries: CsvEntry[];
  generatedAt: string;
}) {
  const { businessName, fiscal, report, entries, generatedAt } = input;
  const { months, totals, rbt12, usesPartner } = report;
  const isSimples = fiscal.regime === "simples";
  const lines: string[][] = [];
  const row = (...cells: string[]) => lines.push(cells);
  const blank = () => lines.push([]);

  row(csvText("Relatório para o contador"));
  row(csvText("Espaço"), csvText(businessName));
  row(csvText("CNPJ"), csvText(formatCnpj(fiscal.cnpj) || "Não informado"));
  row(csvText("Enquadramento"), csvText(fiscal.regime ? REGIME_LABEL[fiscal.regime] : "Não definido"));
  row(csvText("Período"), csvText(`${monthLabel(report.from)} a ${monthLabel(report.to)}`));
  row(csvText("Gerado em"), csvText(generatedAt));
  row(csvText("Aviso"), csvText(NOTES.disclaimer));
  row(csvText("Regime de caixa"), csvText(NOTES.cashBasis));
  row(csvText("Base"), csvText(baseLabel(usesPartner)));
  blank();

  row(csvText("Receitas por mês"));
  row(
    ...["Mês", "Serviços e pacotes", "Produtos", "Outras entradas*", "Receita total",
      ...METHODS.map((k) => METHOD_LABEL[k]),
      ...(usesPartner ? ["Repasse parceiros", "Cota-parte do salão"] : []),
      ...(isSimples ? ["RBT12"] : []),
      "Despesas"].map(csvText)
  );
  for (const m of [...months, totals]) {
    const isTotal = m === totals;
    row(
      csvText(isTotal ? "Total" : monthLabel(m.month)),
      csvNum(m.services), csvNum(m.products), csvNum(m.other), csvNum(m.income),
      ...METHODS.map((k) => csvNum(m.byMethod[k])),
      ...(usesPartner ? [csvNum(m.partner), csvNum(m.salonShare)] : []),
      ...(isSimples ? [isTotal ? "" : csvNum(rbt12[m.month] ?? 0)] : []),
      csvNum(m.expense)
    );
  }
  row(csvText("* Outras entradas"), csvText(NOTES.otherIncome));
  for (const [c, v] of Object.entries(totals.otherByCategory)) row(csvText(`  ${categoryLabel(c)}`), csvNum(v));
  if (isSimples) row(csvText("RBT12"), csvText("Soma da base dos 12 meses anteriores ao mês."));
  if (usesPartner) row(csvText("Salão-parceiro"), csvText(NOTES.partner));
  blank();

  row(csvText("Despesas por categoria"));
  row(csvText("Categoria"), csvText("Valor"));
  for (const [c, v] of Object.entries(totals.expenseByCategory)) row(csvText(categoryLabel(c)), csvNum(v));
  row(csvText("Total de despesas"), csvNum(totals.expense));
  blank();

  row(csvText(fiscal.regime === "mei" ? "Receita bruta anual (MEI — para a DASN-SIMEI)" : "Receita bruta anual"));
  row(...["Ano", "Serviços e pacotes", "Revenda de produtos", "Outras entradas*", usesPartner ? "Cota-parte do salão" : "Receita bruta"].map(csvText));
  for (const { year, summary } of report.years) {
    row(csvText(year), csvNum(summary.services), csvNum(summary.products), csvNum(summary.other), csvNum(summary.base));
  }
  blank();

  row(csvText("Lançamentos do período"));
  row(...["Data", "Tipo", "Categoria", "Forma", "Descrição", "Valor"].map(csvText));
  for (const e of entries) {
    row(
      csvText(e.entry_date.split("-").reverse().join("/")),
      csvText(e.kind === "income" ? "Entrada" : "Saída"),
      csvText(CATEGORY_LABEL[e.category as CashCategory] ?? e.category),
      csvText(METHOD_LABEL[e.method as CashMethod] ?? e.method),
      csvText(e.description),
      csvNum(Number(e.amount))
    );
  }

  return "﻿" + lines.map((l) => l.join(";")).join("\r\n") + "\r\n";
}
