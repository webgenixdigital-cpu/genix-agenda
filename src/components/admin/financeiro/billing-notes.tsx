import { AlertTriangle, Info } from "lucide-react";
import { NOTES, type Alert } from "@/lib/faturamento";
import { cn } from "@/lib/utils";

/** Avisos fixos: relatório de apoio + regime de caixa */
export function ReportNotes({ className }: { className?: string }) {
  return (
    <div className={cn("flex gap-2 rounded-xl bg-secondary p-4 text-sm text-muted-foreground", className)} data-testid="aviso-relatorio-apoio">
      <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
      <p>
        <strong className="text-foreground">{NOTES.disclaimer}</strong> {NOTES.cashBasis}
      </p>
    </div>
  );
}

const TONE: Record<Alert["tone"], string> = {
  info: "border-sky-200 bg-sky-50 text-sky-900",
  warn: "border-amber-300 bg-amber-50 text-amber-900",
  danger: "border-red-200 bg-red-50 text-red-900",
};

export function AlertBox({ alert, testId }: { alert: Alert; testId: string }) {
  const Icon = alert.tone === "info" ? Info : AlertTriangle;
  return (
    <p className={cn("flex gap-2 rounded-xl border p-3 text-sm font-medium", TONE[alert.tone])} data-testid={testId}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      {alert.text}
    </p>
  );
}
