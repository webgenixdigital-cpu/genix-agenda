"use client";

// Dividir o pagamento (68_pagamento_parcial.sql): até 4 partes, cada uma com forma e
// valor. Mostra quanto falta (fica Pagamento pendente) ou quanto passou (o banco
// recusa). Usado no Concluir e no Registrar pagamento. Estado fica com quem usa.
import { Plus, X } from "lucide-react";
import type { PaymentMethod, PaymentPart } from "@/app/admin/(painel)/agenda/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { brl } from "@/lib/format";
import { cn } from "@/lib/utils";

export const PAYMENT_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: "pix", label: "Pix" },
  { value: "dinheiro", label: "Dinheiro" },
  { value: "credito", label: "Cartão de crédito" },
  { value: "debito", label: "Cartão de débito" },
];

export const MAX_PARTS = 4;

/** Linha do formulário: valor em texto (vírgula decimal) */
export type SplitRow = { key: number; method: PaymentMethod | null; amount: string };

export const toMoneyInput = (n: number) => n.toFixed(2).replace(".", ",");
/** "1.234,56" ou "10,5" (vírgula decimal) e também "10.5" */
export const parseMoney = (v: string) => Number(v.includes(",") ? v.replace(/\./g, "").replace(",", ".") : v);
const cents = (n: number) => Math.round(n * 100);

let nextKey = 1;
export const newRow = (amount = 0, method: PaymentMethod | null = null): SplitRow => ({
  key: nextKey++,
  method,
  amount: amount > 0 ? toMoneyInput(amount) : "",
});

/** Soma (em reais) e validação das linhas */
export function splitSummary(rows: SplitRow[], due: number) {
  const values = rows.map((r) => parseMoney(r.amount));
  const valid = values.every((v) => Number.isFinite(v) && v > 0);
  const sumCents = values.reduce((s, v) => s + (Number.isFinite(v) ? cents(v) : 0), 0);
  const diff = cents(due) - sumCents;
  return {
    sum: sumCents / 100,
    missing: diff > 0 ? diff / 100 : 0,
    over: diff < 0 ? -diff / 100 : 0,
    valid: valid && rows.every((r) => r.method !== null),
  };
}

/** Partes prontas para a action, ou a mensagem do que falta preencher */
export function splitParts(rows: SplitRow[], due: number): PaymentPart[] | string {
  if (rows.some((r) => !r.method)) return "Escolha a forma de pagamento de cada parte.";
  const parts = rows.map((r) => ({ method: r.method as PaymentMethod, amount: cents(parseMoney(r.amount)) / 100 }));
  if (parts.some((p) => !Number.isFinite(p.amount) || p.amount <= 0)) return "Informe um valor maior que zero em cada parte.";
  if (splitSummary(rows, due).over > 0) return "A soma passa do valor a pagar. Confira os valores.";
  return parts;
}

export function PaymentSplit({
  rows,
  onChange,
  due,
  disabled,
  testId = "dividir",
}: {
  rows: SplitRow[];
  onChange: (rows: SplitRow[]) => void;
  /** valor a pagar agora (cobrado na conclusão; saldo no Registrar) */
  due: number;
  disabled?: boolean;
  testId?: string;
}) {
  const s = splitSummary(rows, due);
  const set = (key: number, patch: Partial<SplitRow>) => onChange(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  return (
    <div className="space-y-2" data-testid={`${testId}-pagamento`}>
      {rows.map((r, i) => (
        <div key={r.key} className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <Select
              value={r.method ?? undefined}
              onValueChange={(v) => set(r.key, { method: v as PaymentMethod })}
              disabled={disabled}
            >
              <SelectTrigger className="h-11" aria-label={`Forma da parte ${i + 1}`} data-testid={`${testId}-forma-${i}`}>
                <SelectValue placeholder="Forma" />
              </SelectTrigger>
              <SelectContent>
                {PAYMENT_METHODS.map((m) => (
                  <SelectItem key={m.value} value={m.value}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Input
            inputMode="decimal"
            className="h-11 w-28 shrink-0"
            placeholder="0,00"
            aria-label={`Valor da parte ${i + 1} (R$)`}
            value={r.amount}
            disabled={disabled}
            onChange={(e) => set(r.key, { amount: e.target.value.replace(/[^\d,.]/g, "") })}
            data-testid={`${testId}-valor-${i}`}
          />
          {rows.length > 1 ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-11 w-11 shrink-0"
              aria-label={`Tirar a parte ${i + 1}`}
              disabled={disabled}
              onClick={() => onChange(rows.filter((x) => x.key !== r.key))}
              data-testid={`${testId}-tirar-${i}`}
            >
              <X className="h-4 w-4" />
            </Button>
          ) : (
            <span className="w-11 shrink-0" aria-hidden />
          )}
        </div>
      ))}

      {rows.length < MAX_PARTS && (
        <Button
          type="button"
          variant="outline"
          className="h-11 w-full"
          disabled={disabled}
          onClick={() => onChange([...rows, newRow(s.missing)])}
          data-testid={`${testId}-outra-forma`}
        >
          <Plus className="mr-1.5 h-4 w-4" /> Outra forma
        </Button>
      )}

      <p
        className={cn(
          "flex flex-wrap justify-between gap-x-3 rounded-lg px-3 py-2 text-sm",
          s.over > 0 ? "bg-red-50 text-destructive" : s.missing > 0 ? "bg-amber-50 text-amber-900" : "bg-muted"
        )}
        data-testid={`${testId}-resumo`}
      >
        <span>
          Soma: <strong>{brl(s.sum)}</strong> de {brl(due)}
        </span>
        <span>
          {s.over > 0
            ? `Passou ${brl(s.over)}`
            : s.missing > 0
              ? `Falta ${brl(s.missing)}: fica Pagamento pendente`
              : "Valor completo"}
        </span>
      </p>
    </div>
  );
}
