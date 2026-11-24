"use client";

import { useState, useTransition } from "react";
import { CreditCard, Loader2, Lock, QrCode } from "lucide-react";
import { startSubscription } from "@/app/admin/(painel)/assinatura/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { brl } from "@/lib/format";
import { isValidCpfCnpj, maskCpfCnpj } from "@/lib/cpf-cnpj";
import { isSoloKind, planIdFor, type Cycle, type PaidKind } from "@/lib/plan-ids";
import { PLAN_NAMES } from "@/lib/plan-features";
import { cn } from "@/lib/utils";

/** valores calculados no banco (subscription_quote) para cada plano e ciclo */
export type Quotes = Record<PaidKind, Record<Cycle, number>>;

/** cupom de lançamento (53): preço cheio e aviso ("Preço de lançamento até 31/12/2026 · por 12 meses"); null = sem desconto */
export type Discounts = Record<PaidKind, Record<Cycle, { full: number; note: string } | null>>;

type Props = {
  quotes: Quotes;
  discounts?: Discounts | null;
  /** profissionais ativos (Básico e Profissional são para 1) */
  activePros: number;
  /** extras cobrados no Equipe (além dos 3 inclusos) */
  equipeExtras: number;
  /** plano sugerido (destaque "Indicado para você") */
  recommended: PaidKind;
  firstDueLabel: string; // "hoje" ou "em 03/11/2026 (fim do teste)"
};

const METHODS = [
  { value: "PIX", label: "Pix", icon: QrCode, hint: "Confirmação em minutos" },
  { value: "CREDIT_CARD", label: "Cartão", icon: CreditCard, hint: "Renova sozinho" },
] as const;

const KINDS: { id: PaidKind; title: string; text: string }[] = [
  { id: "basico", title: "Básico", text: "Agenda sem prazo, lembretes da véspera e financeiro para 1 profissional." },
  { id: "profissional", title: "Profissional", text: "Tudo do Básico + vitrine online, encaixe, bloqueios, recorrência, retornos, pacotes, combos e WhatsApp automático." },
  { id: "equipe", title: "Equipe", text: "Para salões e equipes: até 3 profissionais, acessos da equipe e comissões." },
];

export function SubscribeForm({ quotes, discounts, activePros, equipeExtras, recommended, firstDueLabel }: Props) {
  const [pending, start] = useTransition();
  const soloBlocked = activePros > 1;
  const [kind, setKind] = useState<PaidKind>(soloBlocked ? "equipe" : recommended);
  const [cycle, setCycle] = useState<Cycle>("anual");
  const [method, setMethod] = useState<(typeof METHODS)[number]["value"]>("PIX");
  const [name, setName] = useState("");
  const [doc, setDoc] = useState("");
  const [error, setError] = useState<string | null>(null);

  const docOk = isValidCpfCnpj(doc);
  const valid = name.trim().length >= 3 && docOk && !(isSoloKind(kind) && soloBlocked);
  const total = quotes[kind][cycle];
  const discount = discounts?.[kind][cycle] ?? null;
  const per = cycle === "anual" ? "/ano" : "/mês";

  function submit() {
    setError(null);
    start(async () => {
      const r = await startSubscription({ planId: planIdFor(kind, cycle), billingType: method, holderName: name, cpfCnpj: doc });
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
        <div className="grid gap-3 md:grid-cols-3">
          {KINDS.map((k) => {
            const disabled = isSoloKind(k.id) && soloBlocked;
            const d = discounts?.[k.id][cycle] ?? null;
            return (
              <button
                key={k.id}
                type="button"
                onClick={() => !disabled && setKind(k.id)}
                aria-pressed={kind === k.id}
                aria-disabled={disabled}
                className={cn(
                  "relative rounded-2xl border-2 p-4 text-left transition-colors",
                  kind === k.id ? "border-primary bg-primary/5" : "border-border bg-card hover:border-primary/40",
                  disabled && "cursor-not-allowed opacity-60 hover:border-border"
                )}
                data-testid={`escolher-plano-${k.id}`}
              >
                {k.id === recommended && !disabled && (
                  <span className="absolute -top-2.5 right-3 rounded-full bg-primary px-2 py-0.5 text-[11px] font-semibold text-primary-foreground">
                    Indicado para você
                  </span>
                )}
                <p className="text-sm font-semibold">{k.title}</p>
                {d && (
                  <p className="mt-1 text-sm text-muted-foreground line-through" data-testid={`preco-cheio-${k.id}`}>
                    <span className="sr-only">Preço normal: </span>
                    {brl(d.full)}
                    {cycle === "anual" ? "/ano" : "/mês"}
                  </p>
                )}
                <p className={cn("font-heading text-3xl md:text-2xl", d ? "mt-0" : "mt-1")}>
                  {brl(quotes[k.id][cycle])}
                  <span className="text-base text-muted-foreground"> {cycle === "anual" ? "/ano" : "/mês"}</span>
                </p>
                {cycle === "anual" && (
                  <p className="text-xs text-muted-foreground">equivale a {brl(quotes[k.id].anual / 12)}/mês</p>
                )}
                {d && (
                  <p
                    className="mt-1.5 w-fit rounded-full bg-[#F2C078]/40 px-2 py-0.5 text-[11px] font-semibold leading-snug text-[#7a4520]"
                    data-testid={`selo-desconto-${k.id}`}
                  >
                    {d.note}
                  </p>
                )}
                <p className="mt-1 text-sm text-muted-foreground">
                  {disabled ? `Você tem ${activePros} profissionais ativos. O ${k.title} é para 1.` : k.text}
                </p>
                {k.id === "equipe" && equipeExtras > 0 && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Inclui {equipeExtras} {equipeExtras === 1 ? "profissional extra" : "profissionais extras"}.
                  </p>
                )}
              </button>
            );
          })}
        </div>

        {/* Mensal / anual */}
        <div className="mt-3 inline-flex rounded-full border bg-white p-1" role="radiogroup" aria-label="Forma de cobrança">
          {(["mensal", "anual"] as const).map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={cycle === c}
              onClick={() => setCycle(c)}
              className={cn(
                "inline-flex h-11 items-center rounded-full px-5 text-sm font-semibold transition-colors",
                cycle === c ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              )}
              data-testid={`ciclo-${c}`}
            >
              {c === "mensal" ? "Mensal" : "Anual · 2 meses grátis"}
            </button>
          ))}
        </div>
      </fieldset>

      {/* 2. Forma de pagamento */}
      <fieldset>
        <legend className="mb-3 text-sm font-semibold text-primary">2. Forma de pagamento</legend>
        <div className="grid grid-cols-2 gap-2">
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
          <strong>
            {PLAN_NAMES[kind]}: {brl(total)}
          </strong>{" "}
          {cycle === "anual" ? `por ano (equivale a ${brl(total / 12)}/mês)` : "por mês"}. Primeira cobrança com vencimento {firstDueLabel}.
        </p>
        {discount && (
          <p className="mt-1" data-testid="resumo-desconto">
            {discount.note.includes("depois")
              ? `${discount.note}, sem precisar fazer nada.`
              : `${discount.note}. Depois, ${brl(discount.full)}${per}, sem precisar fazer nada.`}
          </p>
        )}
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
