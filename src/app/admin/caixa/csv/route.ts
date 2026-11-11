// Planilha (CSV) do Caixa: lançamentos do período e dos filtros atuais
// (mesmo formato do relatório do contador: ; e vírgula decimal, para o Excel pt-BR)
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireRoles } from "@/lib/admin";
import { getPlanContext } from "@/lib/plan";
import { todayInZone } from "@/lib/dates";
import { CATEGORY_LABEL, METHOD_LABEL } from "@/lib/cash";
import { FORMAS, TIPOS, parseCashFilters } from "@/lib/cash-period";
import { entryPeople, loadCashEntries, loadCashSummary } from "@/lib/cash-data";
import { csvNum, csvText } from "@/lib/faturamento-csv";

export const dynamic = "force-dynamic";

const MAX_ROWS = 10_000;

export async function GET(req: NextRequest) {
  // mesmas permissões da página do Caixa (dono; a demonstração só lê)
  const { business } = await requireRoles(["owner", "viewer"]);
  const plan = await getPlanContext(business.id);
  if (plan.tier === "gratis") return NextResponse.json({ error: "Recurso dos planos Profissional e Equipe." }, { status: 403 });

  const tz = business.timezone || "America/Sao_Paulo";
  const today = todayInZone(tz);
  const sp = req.nextUrl.searchParams;
  const f = parseCashFilters(
    { de: sp.get("de") ?? undefined, ate: sp.get("ate") ?? undefined, forma: sp.get("forma") ?? undefined, tipo: sp.get("tipo") ?? undefined },
    today
  );

  const db = createClient();
  const [rows, summary] = await Promise.all([loadCashEntries(db, business.id, f, MAX_ROWS - 1), loadCashSummary(db, business.id, f)]);

  const br = (iso: string) => iso.split("-").reverse().join("/");
  const time = new Intl.DateTimeFormat("pt-BR", { timeZone: tz, hour: "2-digit", minute: "2-digit" });
  const lines: string[][] = [];
  const row = (...cells: string[]) => lines.push(cells);

  row(csvText("Caixa"));
  row(csvText("Espaço"), csvText(business.name));
  row(csvText("Período"), csvText(f.de === f.ate ? br(f.de) : `${br(f.de)} a ${br(f.ate)}`));
  row(csvText("Forma de pagamento"), csvText(FORMAS.find((x) => x.key === f.forma)?.label ?? "Todas"));
  row(csvText("Tipo"), csvText(TIPOS.find((x) => x.key === f.tipo)?.label ?? "Entradas e saídas"));
  row(csvText("Gerado em"), csvText(br(today)));
  row(csvText("Entradas"), csvNum(summary.income));
  row(csvText("Saídas"), csvNum(summary.expense));
  row(csvText("Saldo"), csvNum(summary.income - summary.expense));
  if (summary.count > rows.length)
    row(csvText("Aviso"), csvText(`A planilha traz os ${rows.length} lançamentos mais recentes de ${summary.count}. Escolha um período menor.`));
  lines.push([]);

  row(...["Data", "Hora", "Tipo", "Descrição", "Categoria", "Cliente", "Profissional", "Forma", "Valor"].map(csvText));
  for (const e of rows) {
    const { customer, professional } = entryPeople(e);
    row(
      csvText(br(e.entry_date)),
      csvText(time.format(new Date(e.created_at))),
      csvText(e.kind === "income" ? "Entrada" : "Saída"),
      csvText(e.description ?? CATEGORY_LABEL[e.category] ?? e.category),
      csvText(CATEGORY_LABEL[e.category] ?? e.category),
      csvText(customer),
      csvText(professional),
      csvText(METHOD_LABEL[e.method] ?? e.method),
      // saída negativa: a soma da coluna dá o saldo
      csvNum(e.kind === "income" ? e.amount : -e.amount)
    );
  }

  const csv = "﻿" + lines.map((l) => l.join(";")).join("\r\n") + "\r\n";
  const name = f.de === f.ate ? f.de : `${f.de}-a-${f.ate}`;
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="caixa-${name}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
