"use client";

// "Registrar pagamento" de um atendimento ou pacote com Pagamento pendente
// (49_pagamento_depois.sql; partes e saldo na 68_pagamento_parcial.sql):
// mostra total, já pago e o que falta. Tocar na forma só a seleciona e mostra o valor
// (já com o que falta); “+ Outra forma” divide; pode ser parcial.
// Quem abre guarda o alvo (cópia), fora de qualquer lista: ver booking-dialogs.tsx.
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { getPaymentBalance, registerBookingPayment, registerPackagePayment } from "@/app/admin/(painel)/agenda/actions";
import { Ajuda } from "@/components/ajuda";
import { PaymentSplit, newRow, splitParts, splitSummary, type SplitRow } from "@/components/admin/payment-split";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { brl } from "@/lib/format";

export type PaymentTarget = {
  kind: "booking" | "package";
  id: string;
  customerName: string;
  /** "Corte · 20/11" / "Pacote 10 drenagens" */
  description: string;
  /** saldo já conhecido (lista de pendentes); null = busca no banco */
  suggested: number | null;
};

type Balance = { total: number; paid: number; remaining: number };

export function RegisterPaymentDialog({
  open,
  onOpenChange,
  target,
  today,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  target: PaymentTarget | null;
  /** hoje no fuso do espaço (AAAA-MM-DD) */
  today: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [balance, setBalance] = useState<Balance | null>(null);
  const [rows, setRows] = useState<SplitRow[]>([]);
  const [date, setDate] = useState(today);
  const [error, setError] = useState<string | null>(null);

  // abre limpo: busca total, pago e saldo; a 1ª parte já vem com o saldo
  // (o alvo chega como objeto novo a cada render: as dependências são os campos)
  const kind = target?.kind;
  const id = target?.id;
  const suggested = target?.suggested ?? null;
  useEffect(() => {
    if (!open || !kind || !id) return;
    let alive = true;
    setBalance(null);
    setDate(today);
    setError(null);
    setRows([newRow()]);
    void getPaymentBalance(kind, id).then((r) => {
      if (!alive || !r) return;
      if (!r.ok) return setError(r.error);
      setBalance({ total: r.total, paid: r.paid, remaining: r.remaining });
    });
    return () => {
      alive = false;
    };
  }, [open, kind, id, suggested, today]);

  const due = balance?.remaining ?? target?.suggested ?? 0;

  function save() {
    if (!target) return;
    const parts = splitParts(rows, due);
    if (typeof parts === "string") return setError(parts);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > today) return setError("A data do pagamento não pode ser no futuro.");
    setError(null);
    start(async () => {
      const r =
        target.kind === "booking"
          ? await registerBookingPayment({ bookingId: target.id, payments: parts, date })
          : await registerPackagePayment({ packageId: target.id, payments: parts, date });
      if (!r) return; // demonstração: o servidor redirecionou
      if (!r.ok) return setError(r.error);
      const sum = parts.reduce((s, p) => s + p.amount, 0);
      toast.success(
        r.remaining > 0
          ? `Pagamento parcial registrado (${brl(sum)}). Falta ${brl(r.remaining)}.`
          : `Pagamento registrado no caixa (${brl(sum)}). Tudo pago.`
      );
      onOpenChange(false);
      router.refresh();
    });
  }

  const summary = splitSummary(rows, due);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92svh] w-[calc(100%-1.5rem)] max-w-sm overflow-y-auto rounded-2xl">
        <DialogHeader>
          <DialogTitle className="font-heading text-2xl">
            Registrar pagamento <Ajuda id="registrar-pagamento" className="-ml-2" />
          </DialogTitle>
          <DialogDescription>
            {target ? [target.customerName, target.description].filter(Boolean).join(" · ") : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {balance ? (
            <dl className="grid grid-cols-3 gap-2 rounded-xl border p-3 text-center text-sm" data-testid="saldo-pagamento">
              <div className="min-w-0">
                <dt className="text-xs text-muted-foreground">Total</dt>
                <dd className="font-semibold">{brl(balance.total)}</dd>
              </div>
              <div className="min-w-0">
                <dt className="text-xs text-muted-foreground">Já pago</dt>
                <dd className="font-semibold">{brl(balance.paid)}</dd>
              </div>
              <div className="min-w-0">
                <dt className="text-xs text-muted-foreground">Falta</dt>
                <dd className="font-semibold text-amber-900">{brl(balance.remaining)}</dd>
              </div>
            </dl>
          ) : (
            !error && (
              <p className="flex items-center justify-center gap-2 py-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
              </p>
            )
          )}

          <div className="space-y-1.5">
            <div className="flex items-center gap-1">
              <Label>Forma de pagamento</Label>
              <Ajuda id="dividir-pagamento" />
            </div>
            <PaymentSplit rows={rows} onChange={setRows} due={due} disabled={pending || !balance} testId="pagamento" />
          </div>
          {summary.valid && summary.missing > 0 && (
            <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900" data-testid="aviso-registrar-pendente">
              Faltam <strong>{brl(summary.missing)}</strong>: esse valor continua como <strong>Pagamento pendente</strong>.
            </p>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="pg-data">Data do pagamento</Label>
            <Input
              id="pg-data"
              type="date"
              className="h-11"
              max={today}
              value={date}
              onChange={(e) => setDate(e.target.value)}
              data-testid="input-data-pagamento"
            />
          </div>

          {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-destructive">{error}</p>}

          <Button
            className="h-12 w-full text-base"
            disabled={pending || !target || !balance || !summary.valid}
            onClick={save}
            data-testid="btn-salvar-pagamento"
          >
            {pending ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : summary.valid && summary.missing > 0 ? (
              `Registrar com ${brl(summary.missing)} pendente`
            ) : (
              `Registrar e lançar ${brl(summary.valid ? summary.sum : due)}`
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
