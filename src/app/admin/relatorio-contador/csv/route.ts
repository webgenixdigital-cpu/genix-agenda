// Planilha (CSV) do relatório para o contador
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireRoles } from "@/lib/admin";
import { getPlanContext } from "@/lib/plan";
import { todayISO } from "@/lib/dates";
import { lastDayOf, parsePeriod } from "@/lib/faturamento";
import { loadAccountantReport } from "@/lib/faturamento-data";
import { buildCsv, type CsvEntry } from "@/lib/faturamento-csv";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { business } = await requireRoles(["owner", "viewer"]);
  const plan = await getPlanContext(business.id);
  if (plan.tier === "gratis") return NextResponse.json({ error: "Recurso do plano Completo." }, { status: 403 });

  const today = todayISO();
  const sp = req.nextUrl.searchParams;
  const { from, to } = parsePeriod({ de: sp.get("de") ?? undefined, ate: sp.get("ate") ?? undefined }, today);

  const [{ fiscal, report }, { data: entries }] = await Promise.all([
    loadAccountantReport(business.id, from, to, today),
    createClient()
      .from("cash_entries")
      .select("entry_date, kind, category, method, description, amount")
      .eq("business_id", business.id)
      .gte("entry_date", `${from}-01`)
      .lte("entry_date", lastDayOf(to))
      .order("entry_date")
      .order("created_at")
      .limit(10000),
  ]);

  const csv = buildCsv({
    businessName: business.name,
    fiscal,
    report,
    entries: (entries ?? []) as CsvEntry[],
    generatedAt: today.split("-").reverse().join("/"),
  });

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="relatorio-contador-${from}-a-${to}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
