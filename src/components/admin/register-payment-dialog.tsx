"use client";

// "Registrar pagamento" de um atendimento ou pacote com Pagamento pendente
// (49_pagamento_depois.sql): forma + valor (sugere o cobrado) + data (hoje).
// Quem abre guarda o alvo (cópia), fora de qualquer lista: ver booking-dialogs.tsx.
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { registerBookingPayment, registerPackagePayment, type PaymentMethod } from "@/app/admin/(painel)/agenda/actions";
import { Ajuda } from "@/components/ajuda";
import { bookingTotals, useBookingEditInfo } from "@/components/admin/agenda/edit-booking-dialog";
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
  /** valor sugerido; null = atendimento: busca o cobrado (total − itens do pacote) */
  suggested: number | null;
};

const METHODS: { value: PaymentMethod; label: string }[] = [
  { value: "pix", label: "Pix" },
  { value: "dinheiro", label: "Dinheiro" },
  { value: "credito", label: "Cartão de crédito" },
  { value: "debito", label: "Cartão de débito" },
];

const toInput = (n: number) => n.toFixed(2).replace(".", ",");
/** "1.234,56" ou "10,5" (vírgula decimal) e também "10.5" */
const parseMoney = (v: string) => Number(v.includes(",") ? v.replace(/\./g, "").replace(",", ".") : v);

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
  const [method, setMethod] = useState<PaymentMethod | null>(null);
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(today);
  const [error, setError] = useState<string | null>(null);

  // atendimento sem valor sugerido: o cobrado vem do mesmo cálculo do Concluir
  const needsInfo = open && target?.kind === "booking" && target.suggested === null;
  const info = useBookingEditInfo(target?.id ?? "", needsInfo);
  const suggested = target?.suggested ?? (info.info ? bookingTotals(info.info).charge : null);

  // abre limpo, com o valor sugerido e a data de hoje
  useEffect(() => {
    if (!open) return;
    setMethod(null);
    setDate(today);
    setError(null);
    setAmount("");
  }, [open, target?.id, today]);
  useEffect(() => {
    if (open && suggested !== null && amount === "") setAmount(toInput(suggested));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, suggested]);

  function save() {
    if (!target) return;
    const value = parseMoney(amount);
    if (!method) return setError("Escolha a forma de pagamento.");
    if (!Number.isFinite(value) || value <= 0) return setError("Informe um valor maior que zero.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > today) return setError("A data do pagamento não pode ser no futuro.");
    setError(null);
    start(async () => {
      const input = { method, amount: Math.round(value * 100) / 100, date };
      const r =
        target.kind === "booking"
          ? await registerBookingPayment({ bookingId: target.id, ...input })
          : await registerPackagePayment({ packageId: target.id, ...input });
      if (!r) return; // demonstração: o servidor redirecionou
      if (!r.ok) return setError(r.error);
      toast.success(`Pagamento registrado no caixa (${brl(input.amount)})`);
      onOpenChange(false);
      router.refresh();
    });
  }

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
          <div className="space-y-1.5">
            <Label>Forma de pagamento</Label>
            <div className="grid grid-cols-2 gap-2">
              {METHODS.map((m) => (
                <Button
                  key={m.value}
                  type="button"
                  variant={method === m.value ? "default" : "outline"}
                  className="h-11"
                  onClick={() => setMethod(m.value)}
                  data-testid={`pagamento-depois-${m.value}`}
                >
                  {m.label}
                </Button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="min-w-0 space-y-1.5">
              <Label htmlFor="pg-valor">Valor (R$)</Label>
              <Input
                id="pg-valor"
                inputMode="decimal"
                className="h-11"
                placeholder={needsInfo && suggested === null ? "carregando…" : "0,00"}
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^\d,.]/g, ""))}
                data-testid="input-valor-pagamento"
              />
            </div>
            <div className="min-w-0 space-y-1.5">
              <Label htmlFor="pg-data">Data</Label>
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
          </div>
          {suggested !== null && (
            <p className="text-xs text-muted-foreground">
              Valor sugerido: {brl(suggested)} (o que foi cobrado). Pode mudar se o cliente pagou outro valor.
            </p>
          )}

          {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-destructive">{error}</p>}

          <Button className="h-12 w-full text-base" disabled={pending || !target} onClick={save} data-testid="btn-salvar-pagamento">
            {pending ? <Loader2 className="h-5 w-5 animate-spin" /> : "Registrar no caixa"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
