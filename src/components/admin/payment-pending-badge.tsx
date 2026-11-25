// Selo "Pagamento pendente" (49_pagamento_depois.sql): atendimento concluído ou pacote
// vendido com "Escolher depois", ainda sem pagamento completo no caixa.
// 68: com parte já paga, mostra "Falta R$ X" (remaining) ou "Pagamento parcial"
// (quando quem desenha não sabe o saldo). Sem "use client": serve em telas do
// servidor e do navegador.
import { Clock } from "lucide-react";
import { brl } from "@/lib/format";
import { cn } from "@/lib/utils";

export function PaymentPendingBadge({
  className,
  testId,
  remaining,
  partial,
}: {
  className?: string;
  testId?: string;
  /** saldo, quando já há parte paga */
  remaining?: number | null;
  /** há parte paga, mas o saldo não é conhecido aqui */
  partial?: boolean;
}) {
  const text =
    remaining != null && remaining > 0 ? `Falta ${brl(remaining)}` : partial ? "Pagamento parcial" : "Pagamento pendente";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-900",
        className
      )}
      data-testid={testId ?? "selo-pagamento-pendente"}
    >
      <Clock className="h-3 w-3" aria-hidden /> {text}
    </span>
  );
}

/**
 * Saldo de um atendimento pendente para o selo (68). Só quando já há parte paga;
 * sessão de pacote: o cobrado depende dos itens, então devolve null (selo "parcial").
 */
export function bookingBadgeRemaining(b: { price: number | string; amount_paid?: number | string | null; customer_package_id?: string | null }) {
  const paid = Number(b.amount_paid ?? 0);
  if (!(paid > 0) || b.customer_package_id) return null;
  return Math.max(Math.round((Number(b.price) - paid) * 100) / 100, 0);
}
