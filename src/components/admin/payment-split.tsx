"use client";

// Formas de pagamento (68_pagamento_parcial.sql), no Concluir e no Registrar pagamento.
// Tocar numa forma só a SELECIONA e mostra o campo Valor, já com o que falta (editável).
// "+ Outra forma" abre outra parte (até 4). O resumo mostra Total · Lançado · Falta.
// Quem usa guarda as linhas e desenha o botão final (Concluir/Registrar).
import { Plus, X } from "lucide-react";
import type { PaymentMethod, PaymentPart } from "@/app/admin/(painel)/agenda/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { brl } from "@/lib/format";
import { cn } from "@/lib/utils";

export const PAYMENT_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: "pix", label: "Pix" },
  { value: "dinheiro", label: "Dinheiro" },
  { value: "credito", label: "Cartão de crédito" },
  { value: "debito", label: "Cartão de débito" },
];

export const MAX_PARTS = 4;

/** Uma parte: forma (null = ainda não escolhida) e valor em texto (vírgula decimal) */
export type SplitRow = { key: number; method: PaymentMethod | null; amount: string };

export const toMoneyInput = (n: number) => n.toFixed(2).replace(".", ",");
/** "1.234,56" ou "10,5" (vírgula decimal) e também "10.5" */
export const parseMoney = (v: string) => Number(v.includes(",") ? v.replace(/\./g, "").replace(",", ".") : v);
const cents = (n: number) => Math.round(n * 100);

let nextKey = 1;
/** Parte vazia (sem forma; o valor entra quando a forma é escolhida) */
export const newRow = (): SplitRow => ({ key: nextKey++, method: null, amount: "" });

/** Soma do que tem forma escolhida, o que falta e o que passou */
export function splitSummary(rows: SplitRow[], due: number) {
  const chosen = rows.filter((r) => r.method !== null);
  const values = chosen.map((r) => parseMoney(r.amount));
  const sumCents = values.reduce((s, v) => s + (Number.isFinite(v) && v > 0 ? cents(v) : 0), 0);
  const diff = cents(due) - sumCents;
  return {
    sum: sumCents / 100,
    missing: diff > 0 ? diff / 100 : 0,
    over: diff < 0 ? -diff / 100 : 0,
    /** pelo menos 1 forma, todas as partes com forma e valor > 0, sem passar do total */
    valid:
      chosen.length > 0 &&
      chosen.length === rows.length &&
      values.every((v) => Number.isFinite(v) && v > 0) &&
      diff >= 0,
  };
}

/** Partes prontas para a action, ou a mensagem do que falta preencher */
export function splitParts(rows: SplitRow[], due: number): PaymentPart[] | string {
  if (rows.length === 0 || rows.some((r) => !r.method)) return "Escolha a forma de pagamento de cada parte.";
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
  testId = "pagamento",
}: {
  rows: SplitRow[];
  onChange: (rows: SplitRow[]) => void;
  /** valor a pagar agora (cobrado no Concluir; saldo no Registrar) */
  due: number;
  disabled?: boolean;
  testId?: string;
}) {
  const s = splitSummary(rows, due);

  // escolher a forma: se a parte ainda não tem valor, entra o que falta (sem contar ela)
  function choose(key: number, method: PaymentMethod) {
    const others = splitSummary(
      rows.filter((r) => r.key !== key),
      due
    );
    onChange(
      rows.map((r) =>
        r.key === key
          ? { ...r, method, amount: r.amount === "" && others.missing > 0 ? toMoneyInput(others.missing) : r.amount }
          : r
      )
    );
  }
  const setAmount = (key: number, amount: string) => onChange(rows.map((r) => (r.key === key ? { ...r, amount } : r)));
  const canAdd = rows.length < MAX_PARTS && rows.every((r) => r.method !== null) && s.missing > 0;

  return (
    <div className="space-y-3" data-testid={`${testId}-formas`}>
      {rows.map((r, i) => (
        <div key={r.key} className={cn("space-y-2", rows.length > 1 && "rounded-xl border p-2")}>
          {rows.length > 1 && (
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-muted-foreground">Forma {i + 1}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-11 w-11"
                aria-label={`Tirar a forma ${i + 1}`}
                disabled={disabled}
                onClick={() => onChange(rows.filter((x) => x.key !== r.key))}
                data-testid={`${testId}-tirar-${i}`}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={`Forma de pagamento ${i + 1}`}>
            {PAYMENT_METHODS.map((m) => {
              const on = r.method === m.value;
              return (
                <Button
                  key={m.value}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  variant={on ? "default" : "outline"}
                  className="h-12"
                  disabled={disabled}
                  onClick={() => choose(r.key, m.value)}
                  data-testid={`${testId}-forma-${i}-${m.value}`}
                >
                  {m.label}
                </Button>
              );
            })}
          </div>
          {r.method && (
            <div className="flex items-center gap-2">
              <label htmlFor={`${testId}-valor-${r.key}`} className="shrink-0 text-sm font-medium">
                Valor (R$)
              </label>
              <Input
                id={`${testId}-valor-${r.key}`}
                inputMode="decimal"
                className="h-11 min-w-0 flex-1"
                placeholder="0,00"
                value={r.amount}
                disabled={disabled}
                onChange={(e) => setAmount(r.key, e.target.value.replace(/[^\d,.]/g, ""))}
                data-testid={`${testId}-valor-${i}`}
              />
            </div>
          )}
        </div>
      ))}

      {canAdd && (
        <Button
          type="button"
          variant="outline"
          className="h-11 w-full"
          disabled={disabled}
          onClick={() => onChange([...rows, newRow()])}
          data-testid={`${testId}-outra-forma`}
        >
          <Plus className="mr-1.5 h-4 w-4" /> Outra forma
        </Button>
      )}

      <p
        className={cn(
          "flex flex-wrap justify-between gap-x-3 gap-y-1 rounded-lg px-3 py-2 text-sm",
          s.over > 0 ? "bg-red-50 text-destructive" : s.missing > 0 && s.sum > 0 ? "bg-amber-50 text-amber-900" : "bg-muted"
        )}
        data-testid={`${testId}-resumo`}
      >
        <span>Total {brl(due)}</span>
        <span>Lançado {brl(s.sum)}</span>
        <span className="font-semibold">{s.over > 0 ? `Passou ${brl(s.over)}` : `Falta ${brl(s.missing)}`}</span>
      </p>
    </div>
  );
}
