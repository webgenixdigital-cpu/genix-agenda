"use client";

import { useState, useTransition } from "react";
import { Barcode, CreditCard, Loader2, Lock, QrCode } from "lucide-react";
import { startSubscription } from "@/app/admin/(painel)/assinatura/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { brl } from "@/lib/format";
import { isValidCpfCnpj, maskCpfCnpj } from "@/lib/cpf-cnpj";
import { cn } from "@/lib/utils";

type Props = {
  monthly: number;
  yearly: number;
  firstDueLabel: string;   // "hoje" ou "em 03/11/2026 (fim do teste)"
};

const METHODS = [
  { value: "PIX", label: "Pix", icon: QrCode, hint: "Confirmação em minutos" },
  { value: "CREDIT_CARD", label: "Cartão", icon: CreditCard, hint: "Renova sozinho" },
  { value: "BOLETO", label: "Boleto", icon: Barcode, hint: "Até 3 dias úteis" },
] as const;

export function SubscribeForm({ monthly, yearly, firstDueLabel }: Props) {
  const [pending, start] = useTransition();
  const [planId, setPlanId] = useState<"mensal" | "anual">("anual");
  const [method, setMethod] = useState<(typeof METHODS)[number]["value"]>("PIX");
  const [name, setName] = useState("");
  const [doc, setDoc] = useState("");
  const [error, setError] = useState<string | null>(null);

  const docOk = isValidCpfCnpj(doc);
  const valid = name.trim().length >= 3 && docOk;
  const savings = monthly * 12 - yearly;

  function submit() {
    setError(null);
    start(async () => {
      const r = await startSubscription({ planId, billingType: method, holderName: name, cpfCnpj: doc });
      if (!r) return; // demonstração: o servidor redirecionou
      if (!r.ok) {
        setError(r.error);
        return;
      }
      if (r.invoiceUrl) window.location.href = r.invoiceUrl;
    });
  }

  return (
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid && !pending) submit();
      }}
    >
      {/* 1. Plano */}
      <fieldset>
        <legend className="mb-3 text-sm font-semibold text-primary">1. Escolha o plano</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {([
            { id: "mensal", title: "Mensal", price: brl(monthly), suffix: "/mês", note: "Sem fidelidade" },
            { id: "anual", title: "Anual", price: brl(yearly), suffix: "/ano", note: `Economia de ${brl(savings)} (2 meses grátis)` },
          ] as const).map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setPlanId(p.id)}
              aria-pressed={planId === p.id}
              className={cn(
                "rounded-2xl border-2 p-4 text-left transition-colors",
                planId === p.id ? "border-primary bg-primary/5" : "border-border bg-card hover:border-primary/40"
              )}
              data-testid={`escolher-plano-${p.id}`}
            >
              <p className="text-sm font-semibold">{p.title}</p>
              <p className="mt-1 font-heading text-3xl">
                {p.price}
                <span className="text-base text-muted-foreground"> {p.suffix}</span>
              </p>
              <p className={cn("mt-1 text-sm", p.id === "anual" ? "text-green-700" : "text-muted-foreground")}>{p.note}</p>
            </button>
          ))}
        </div>
      </fieldset>

      {/* 2. Forma de pagamento */}
      <fieldset>
        <legend className="mb-3 text-sm font-semibold text-primary">2. Forma de pagamento</legend>
        <div className="grid grid-cols-3 gap-2">
          {METHODS.map(({ value, label, icon: Icon, hint }) => (
            <button
              key={value}
              type="button"
              onClick={() => setMethod(value)}
              aria-pressed={method === value}
              className={cn(
                "flex flex-col items-center gap-1 rounded-xl border-2 px-2 py-3 text-center transition-colors",
                method === value ? "border-primary bg-primary/5" : "border-border bg-card hover:border-primary/40"
              )}
              data-testid={`metodo-${value.toLowerCase()}`}
            >
              <Icon className="h-5 w-5 text-primary" />
              <span className="text-sm font-semibold">{label}</span>
              <span className="text-[11px] leading-tight text-muted-foreground">{hint}</span>
            </button>
          ))}
        </div>
      </fieldset>

      {/* 3. Quem paga */}
      <fieldset className="space-y-3">
        <legend className="mb-3 text-sm font-semibold text-primary">3. Quem vai pagar</legend>
        <div className="space-y-1.5">
          <Label htmlFor="sb-name">Nome completo ou razão social</Label>
          <Input id="sb-name" className="h-12 text-base" value={name} onChange={(e) => setName(e.target.value.slice(0, 100))} data-testid="input-titular" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="sb-doc">CPF ou CNPJ</Label>
          <Input
            id="sb-doc"
            className="h-12 text-base"
            inputMode="numeric"
            value={doc}
            onChange={(e) => setDoc(maskCpfCnpj(e.target.value))}
            data-testid="input-cpf-cnpj"
          />
          {doc.replace(/\D/g, "").length >= 11 && !docOk && <p className="text-sm text-destructive">Confira os números do CPF ou CNPJ.</p>}
          <p className="text-xs text-muted-foreground">Exigido para emitir a cobrança. Fica guardado apenas no sistema de pagamentos.</p>
        </div>
      </fieldset>

      <div className="rounded-xl bg-secondary p-4 text-sm">
        <p>
          <strong>Total: {brl(planId === "anual" ? yearly : monthly)}</strong> {planId === "anual" ? "por ano" : "por mês"}.
          Primeira cobrança com vencimento {firstDueLabel}.
        </p>
      </div>

      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-destructive" data-testid="erro-assinatura">{error}</p>}

      <Button type="submit" className="h-12 w-full text-base" disabled={!valid || pending} data-testid="btn-ir-pagamento">
        {pending ? <Loader2 className="h-5 w-5 animate-spin" /> : "Ir para o pagamento"}
      </Button>
      <p className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
        <Lock className="h-3.5 w-3.5" /> Pagamento processado com segurança pelo Asaas.
      </p>
    </form>
  );
}
