"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, Minus, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { brl } from "@/lib/format";
import { cn } from "@/lib/utils";

export type Plan = {
  id: string;
  name: string;
  billing_cycle: "MONTHLY" | "YEARLY";
  base_price: number;
  included_professionals: number;
  extra_professional_price: number;
};

// ---------------------------------------------------------------------
// PARTE 1 — O que cada plano inclui
// ---------------------------------------------------------------------
const FREE_INCLUDES = [
  "Vitrine digital com link próprio e QR Code",
  "Pedidos de agendamento pela vitrine",
  "Confirmação com o cliente pelo WhatsApp",
  "Até 10 agendamentos online por dia",
  "1 profissional",
];
const FREE_EXCLUDES = ["Lembretes de véspera", "Bloqueios de férias e folgas", "Financeiro e caixa", "Equipe com vários profissionais"];

const FULL_INCLUDES = [
  "Agendamentos online ilimitados",
  "Lembretes de véspera pelo WhatsApp",
  "Bloqueios de férias, folgas e feriados",
  "Financeiro e caixa com gráficos",
  "Avaliações dos clientes na vitrine",
  "Vitrine sem o selo Genix",
  "Suporte prioritário pelo WhatsApp",
];

// ---------------------------------------------------------------------
// PARTE 2 — Componente
// ---------------------------------------------------------------------
export function Pricing({ plans }: { plans: Plan[] }) {
  const monthly = plans.find((p) => p.billing_cycle === "MONTHLY");
  const yearly = plans.find((p) => p.billing_cycle === "YEARLY");
  const [cycle, setCycle] = useState<"MONTHLY" | "YEARLY">("YEARLY");
  const [pros, setPros] = useState(1);

  if (!monthly || !yearly) return null;

  const included = monthly.included_professionals;
  const extras = Math.max(pros - included, 0);
  const plan = cycle === "MONTHLY" ? monthly : yearly;
  const total = plan.base_price + extras * plan.extra_professional_price;

  const monthlyTotal = monthly.base_price + extras * monthly.extra_professional_price;
  const yearlyTotal = yearly.base_price + extras * yearly.extra_professional_price;
  const savings = monthlyTotal * 12 - yearlyTotal;
  const savingsPct = Math.round((savings / (monthlyTotal * 12)) * 100);

  return (
    <div className="mx-auto max-w-5xl">
      {/* Alternância mensal / anual */}
      <div className="flex justify-center">
        <div className="inline-flex rounded-full border bg-white p-1" role="tablist" aria-label="Forma de pagamento">
          {(["MONTHLY", "YEARLY"] as const).map((c) => (
            <button
              key={c}
              role="tab"
              aria-selected={cycle === c}
              onClick={() => setCycle(c)}
              className={cn(
                "inline-flex h-11 items-center gap-2 rounded-full px-6 text-sm font-semibold transition-colors",
                cycle === c ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              )}
              data-testid={`toggle-${c === "MONTHLY" ? "mensal" : "anual"}`}
            >
              {c === "MONTHLY" ? "Mensal" : "Anual"}
              {c === "YEARLY" && (
                <span className={cn("rounded-full px-2 py-0.5 text-xs", cycle === c ? "bg-white/20" : "bg-green-100 text-green-800")}>
                  2 meses grátis
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-10 grid items-start gap-6 lg:grid-cols-[1fr_1.25fr]">
        {/* ---------- GRÁTIS ---------- */}
        <div className="rounded-3xl border bg-card p-6 md:p-8" data-testid="card-plano-gratis">
          <p className="text-sm font-semibold text-muted-foreground">Grátis</p>
          <div className="mt-3 flex items-end gap-2">
            <p className="font-heading text-5xl leading-none">R$ 0</p>
            <p className="pb-1 text-muted-foreground">para sempre</p>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">Para quem quer começar a receber pedidos pela vitrine.</p>

          <ul className="mt-6 space-y-2.5">
            {FREE_INCLUDES.map((f) => (
              <li key={f} className="flex gap-2.5">
                <Check className="mt-0.5 h-5 w-5 shrink-0 text-primary" /> {f}
              </li>
            ))}
            {FREE_EXCLUDES.map((f) => (
              <li key={f} className="flex gap-2.5 text-muted-foreground">
                <X className="mt-0.5 h-5 w-5 shrink-0 text-stone-400" /> <span className="line-through">{f}</span>
              </li>
            ))}
          </ul>

          <Button asChild variant="outline" className="mt-8 h-12 w-full text-base" data-testid="btn-plano-gratis">
            <Link href="/cadastro">Criar conta grátis</Link>
          </Button>
          <p className="mt-2 text-center text-xs text-muted-foreground">
            Você começa com 15 dias do Completo. Depois, segue grátis se quiser.
          </p>
        </div>

        {/* ---------- COMPLETO ---------- */}
        <div className="relative rounded-3xl border-2 border-primary bg-card p-6 shadow-sm md:p-8" data-testid="card-plano-completo">
          <span className="absolute -top-3 left-6 rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground">
            Mais escolhido
          </span>
          <p className="text-sm font-semibold text-primary">Completo</p>
          <div className="mt-3 flex items-end gap-2">
            <p className="font-heading text-5xl leading-none" data-testid="preco-total">{brl(total)}</p>
            <p className="pb-1 text-muted-foreground">{cycle === "MONTHLY" ? "/mês" : "/ano"}</p>
          </div>
          {cycle === "YEARLY" ? (
            <p className="mt-2 text-sm text-green-700">
              Equivale a {brl(total / 12)} por mês. Você economiza {brl(savings)} ({savingsPct}%) no ano.
            </p>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">Sem fidelidade. Cancele quando quiser.</p>
          )}

          <ul className="mt-6 space-y-2.5">
            <li className="flex gap-2.5 font-semibold">
              <Check className="mt-0.5 h-5 w-5 shrink-0 text-primary" /> Tudo do Grátis, mais:
            </li>
            <li className="flex gap-2.5">
              <Check className="mt-0.5 h-5 w-5 shrink-0 text-primary" /> Até {included} profissionais inclusos
            </li>
            {FULL_INCLUDES.map((f) => (
              <li key={f} className="flex gap-2.5">
                <Check className="mt-0.5 h-5 w-5 shrink-0 text-primary" /> {f}
              </li>
            ))}
          </ul>

          {/* Calculadora */}
          <div className="mt-6 rounded-2xl bg-secondary p-4">
            <p className="text-sm font-semibold">Quantas pessoas atendem no seu espaço?</p>
            <div className="mt-3 flex items-center gap-4">
              <div className="flex items-center rounded-xl bg-white p-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-11 w-11"
                  onClick={() => setPros((n) => Math.max(1, n - 1))}
                  disabled={pros <= 1}
                  aria-label="Menos profissionais"
                  data-testid="btn-menos-profissionais"
                >
                  <Minus className="h-5 w-5" />
                </Button>
                <span className="w-10 text-center font-heading text-2xl" data-testid="qtd-profissionais">{pros}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-11 w-11"
                  onClick={() => setPros((n) => Math.min(30, n + 1))}
                  aria-label="Mais profissionais"
                  data-testid="btn-mais-profissionais"
                >
                  <Plus className="h-5 w-5" />
                </Button>
              </div>
              <p className="text-sm text-muted-foreground">
                {extras === 0
                  ? `Até ${included} profissionais já estão no preço.`
                  : `${extras} ${extras === 1 ? "extra" : "extras"} × ${brl(plan.extra_professional_price)} = ${brl(extras * plan.extra_professional_price)}`}
              </p>
            </div>
          </div>

          <Button asChild className="mt-6 h-12 w-full text-base active:scale-95" data-testid="btn-plano-teste">
            <Link href="/cadastro">Testar 15 dias grátis</Link>
          </Button>
          <p className="mt-2 text-center text-xs text-muted-foreground">Não pedimos cartão para testar.</p>
        </div>
      </div>
    </div>
  );
}