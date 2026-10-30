// Página de impressão do relatório para o contador (fora do layout do painel: sem menu)
import type { Metadata } from "next";
import Link from "next/link";
import { requireRoles } from "@/lib/admin";
import { getPlanContext } from "@/lib/plan";
import { todayISO } from "@/lib/dates";
import { parsePeriod } from "@/lib/faturamento";
import { loadAccountantReport } from "@/lib/faturamento-data";
import { LockedFeature } from "@/components/admin/locked-feature";
import { AccountantReport } from "@/components/admin/financeiro/accountant-report";
import { PrintButton } from "@/components/admin/financeiro/print-button";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Relatório para o contador | Genix Agenda", robots: { index: false, follow: false } };

type Props = { searchParams: { de?: string; ate?: string } };

export default async function RelatorioContadorPrintPage({ searchParams }: Props) {
  const { business } = await requireRoles(["owner", "viewer"]);
  const plan = await getPlanContext(business.id);
  if (plan.tier === "gratis") return <LockedFeature feature="faturamento" />;

  const today = todayISO();
  const { from, to } = parsePeriod(searchParams, today);
  const { fiscal, report } = await loadAccountantReport(business.id, from, to, today);

  return (
    <main className="mx-auto max-w-5xl space-y-4 bg-white p-4 md:p-8 print:max-w-none print:p-0">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link
          href={`/admin/financeiro/contador?de=${from}&ate=${to}`}
          className="inline-flex min-h-11 items-center text-sm underline"
          data-testid="link-voltar-relatorio"
        >
          Voltar ao Financeiro
        </Link>
        <PrintButton />
      </div>
      <AccountantReport
        businessName={business.name}
        fiscal={fiscal}
        report={report}
        generatedAt={today.split("-").reverse().join("/")}
      />
      <p className="text-center text-xs text-muted-foreground">Gerado pelo Genix Agenda · genixagenda.com.br</p>
    </main>
  );
}
