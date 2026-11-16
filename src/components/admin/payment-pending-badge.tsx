// Selo "Pagamento pendente" (49_pagamento_depois.sql): atendimento concluído ou pacote
// vendido com "Escolher depois", ainda sem lançamento no caixa. Sem "use client":
// serve em telas do servidor e do navegador.
import { Clock } from "lucide-react";
import { cn } from "@/lib/utils";

export function PaymentPendingBadge({ className, testId }: { className?: string; testId?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-900",
        className
      )}
      data-testid={testId ?? "selo-pagamento-pendente"}
    >
      <Clock className="h-3 w-3" aria-hidden /> Pagamento pendente
    </span>
  );
}
