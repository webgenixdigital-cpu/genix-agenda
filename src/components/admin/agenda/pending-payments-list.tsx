"use client";

// Lista "Pagamentos pendentes" da Agenda (49_pagamento_depois.sql).
// Um diálogo só, FORA dos itens da lista, preso à cópia do item escolhido
// (lição do PR 43: estado de diálogo nunca mora dentro de item de lista).
import { useState } from "react";
import Link from "next/link";
import { Package, Wallet } from "lucide-react";
import type { PendingPaymentItem } from "@/lib/agenda-data";
import { RegisterPaymentDialog, type PaymentTarget } from "@/components/admin/register-payment-dialog";
import { Button } from "@/components/ui/button";
import { brl } from "@/lib/format";
import { formatPhone } from "@/lib/phone";

const br = (iso: string) => iso.split("-").reverse().join("/");

export function PendingPaymentsList({ items, today }: { items: PendingPaymentItem[]; today: string }) {
  const [target, setTarget] = useState<PaymentTarget | null>(null);
  const [open, setOpen] = useState(false);

  if (items.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed bg-white p-10 text-center">
        <p className="font-heading text-2xl">Tudo pago</p>
        <p className="mt-2 text-sm text-muted-foreground">
          Atendimentos concluídos e pacotes vendidos com “Escolher depois” aparecem aqui até o pagamento ser registrado.
        </p>
      </div>
    );
  }

  return (
    <>
      <ul className="space-y-3" data-testid="lista-pagamentos-pendentes">
        {items.map((p) => (
          <li key={`${p.kind}-${p.id}`} className="rounded-2xl border bg-card p-4" data-testid={`pendente-${p.kind}-${p.id}`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-semibold">
                  {p.customer_id ? (
                    <Link href={`/admin/clientes/${p.customer_id}`} className="hover:underline">
                      {p.customer_name}
                    </Link>
                  ) : (
                    p.customer_name
                  )}
                </p>
                <p className="flex items-center gap-1 text-sm text-muted-foreground">
                  {p.kind === "package" && <Package className="h-3.5 w-3.5 shrink-0" aria-label="Pacote" />}
                  <span className="min-w-0 break-words">
                    {p.description}
                    {p.professional_name ? ` com ${p.professional_name}` : ""} · {br(p.ref_date)}
                  </span>
                </p>
                {p.customer_phone && (
                  <p className="text-xs text-muted-foreground">{formatPhone(p.customer_phone, p.customer_phone_country)}</p>
                )}
              </div>
              <p className="shrink-0 text-lg font-semibold">{brl(p.amount)}</p>
            </div>
            <Button
              className="mt-3 h-11 w-full sm:w-auto"
              onClick={() => {
                setTarget({
                  kind: p.kind,
                  id: p.id,
                  customerName: p.customer_name,
                  description: `${p.description} · ${br(p.ref_date)}`,
                  suggested: p.amount,
                });
                setOpen(true);
              }}
              data-testid={`btn-registrar-pagamento-${p.id}`}
            >
              <Wallet className="mr-1.5 h-4 w-4" /> Registrar pagamento
            </Button>
          </li>
        ))}
      </ul>

      <RegisterPaymentDialog open={open} onOpenChange={setOpen} target={target} today={today} />
    </>
  );
}
