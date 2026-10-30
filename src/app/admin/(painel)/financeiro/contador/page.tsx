import Link from "next/link";
import { FileSpreadsheet, Printer } from "lucide-react";
import { requireRoles } from "@/lib/admin";
import { getPlanContext } from "@/lib/plan";
import { todayISO } from "@/lib/dates";
import { parsePeriod } from "@/lib/faturamento";
import { loadAccountantReport } from "@/lib/faturamento-data";
import { LockedFeature } from "@/components/admin/locked-feature";
import { FinanceTabs } from "@/components/admin/financeiro/finance-tabs";
import { AccountantReport } from "@/components/admin/financeiro/accountant-report";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const dynamic = "force-dynamic";

type Props = { searchParams: { de?: string; ate?: string } };

export default async function ContadorPage({ searchParams }: Props) {
  const { business } = await requireRoles(["owner", "viewer"]);
  const plan = await getPlanContext(business.id);
  if (plan.tier === "gratis") return <LockedFeature feature="faturamento" />;

  const today = todayISO();
  const { from, to } = parsePeriod(searchParams, today);
  const { fiscal, report } = await loadAccountantReport(business.id, from, to, today);
  const qs = `de=${from}&ate=${to}`;

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-4 md:p-8">
      <header className="space-y-3">
        <h1 className="text-3xl md:text-4xl">Financeiro</h1>
        <FinanceTabs active="contador" />
      </header>

      {/* Período e exportação */}
      <section className="flex flex-wrap items-end justify-between gap-4 rounded-2xl border bg-card p-5">
        <form method="get" className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="rc-de">De</Label>
            <Input id="rc-de" name="de" type="month" defaultValue={from} className="h-11 w-44" data-testid="input-periodo-de" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rc-ate">Até</Label>
            <Input id="rc-ate" name="ate" type="month" defaultValue={to} className="h-11 w-44" data-testid="input-periodo-ate" />
          </div>
          <Button type="submit" variant="outline" className="h-11" data-testid="btn-atualizar-periodo">Atualizar</Button>
        </form>
        <div className="flex flex-wrap gap-2">
          <Button asChild className="h-11" data-testid="btn-imprimir-relatorio">
            <Link href={`/admin/relatorio-contador?${qs}`} target="_blank" rel="noopener">
              <Printer className="mr-1.5 h-4 w-4" /> Imprimir / PDF
            </Link>
          </Button>
          <Button asChild variant="outline" className="h-11" data-testid="btn-baixar-planilha">
            <a href={`/admin/relatorio-contador/csv?${qs}`} download>
              <FileSpreadsheet className="mr-1.5 h-4 w-4" /> Baixar planilha (CSV)
            </a>
          </Button>
        </div>
      </section>

      <AccountantReport
        businessName={business.name}
        fiscal={fiscal}
        report={report}
        generatedAt={today.split("-").reverse().join("/")}
      />
    </main>
  );
}
