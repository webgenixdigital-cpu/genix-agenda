"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { brl } from "@/lib/format";
import type { Plan } from "@/lib/plans-public";
import { cn } from "@/lib/utils";

// Valores vêm da tabela plans (migrations 28a/28b); nada fixo aqui.

// ---------------------------------------------------------------------
// PARTE 1 — O que cada plano inclui (sem repetir os blocos de benefícios)
// ---------------------------------------------------------------------
const freeIncludes = (limit: number) => [
  "Vitrine com link próprio e QR Code",
  `Agenda online com até ${limit} agendamentos por dia`,
  "1 profissional",
  "Confirmação automática e remarcar",
  "Ficha e histórico de cada cliente",
  "Lembretes de véspera em um toque",
  "Avaliações dos clientes na vitrine",
];

const PRO_INCLUDES = [
  "Agendamentos online ilimitados",
  "Bloqueios de férias, folgas e feriados",
  "Agendamentos recorrentes",
  "Pacotes de sessões e retornos",
  "Financeiro, faturamento e relatório para o contador",
  "Vitrine sem o selo Genix",
];

const TEAM_INCLUDES = [
  "Acessos para recepção e profissionais",
  "Comissões e “Meus ganhos” de cada profissional",
  "Salão-parceiro no faturamento",
];

function Item({ children, strong }: { children: React.ReactNode; strong?: boolean }) {
  return (
    <li className={cn("flex gap-2.5 text-left", strong && "font-semibold")}>
      <Check className="mt-0.5 h-5 w-5 shrink-0 text-primary" /> {children}
    </li>
  );
}

// ---------------------------------------------------------------------
// PARTE 2 — Componente
// ---------------------------------------------------------------------
export function Pricing({ plans }: { plans: Plan[] }) {
  const [cycle, setCycle] = useState<"MONTHLY" | "YEARLY">("YEARLY");
  const [pros, setPros] = useState(3);

  const find = (kind: Plan["kind"], c: Plan["billing_cycle"]) => plans.find((p) => p.kind === kind && p.billing_cycle === c);
  const free = plans.find((p) => p.kind === "gratis");
  const pro = find("profissional", cycle);
  const team = find("equipe", cycle);
  const teamMonthly = find("equipe", "MONTHLY");
  if (!pro || !team) return null;

  const yearly = cycle === "YEARLY";
  const per = yearly ? "/ano" : "/mês";
  const included = team.included_professionals;
  const extras = Math.max(pros - included, 0);
  const teamTotal = team.base_price + extras * team.extra_professional_price;

  return (
    <div className="mx-auto max-w-6xl text-center">
      {/* Alternância mensal / anual */}
      <div className="flex flex-col items-center gap-2">
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
            </button>
          ))}
        </div>
        <p className="text-sm font-semibold text-green-700">2 meses grátis no plano anual</p>
      </div>

      <div className="mt-10 grid items-start gap-8 lg:grid-cols-3">
        {/* ---------- GRÁTIS ---------- */}
        <div className="rounded-3xl border bg-card p-6 md:p-8" data-testid="card-plano-gratis">
          <p className="text-sm font-semibold text-muted-foreground">Grátis</p>
          <div className="mt-3 flex items-end justify-center gap-2">
            <p className="font-heading text-5xl leading-none">R$ 0</p>
            <p className="pb-1 text-muted-foreground">para sempre</p>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">Para começar a receber agendamentos hoje, sem pagar nada.</p>
          <ul className="mx-auto mt-8 w-fit space-y-3">
            {freeIncludes(free?.online_daily_limit ?? 6).map((f) => (
              <Item key={f}>{f}</Item>
            ))}
          </ul>
          <Button asChild variant="outline" className="mt-8 h-12 w-full text-base" data-testid="btn-plano-gratis">
            <Link href="/cadastro">Criar conta grátis</Link>
          </Button>
          <p className="mt-3 text-xs text-muted-foreground">Com o selo “Feito com Genix Agenda” na vitrine.</p>
        </div>

        {/* ---------- PROFISSIONAL ---------- */}
        <div className="relative rounded-3xl border-2 border-primary bg-card p-6 shadow-sm md:p-8" data-testid="card-plano-profissional">
          <span className="absolute -top-3 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground">
            Para quem atende sozinho
          </span>
          <p className="text-sm font-semibold text-primary">Profissional</p>
          <div className="mt-3 flex items-end justify-center gap-2">
            <p className="font-heading text-5xl leading-none" data-testid="preco-profissional">{brl(pro.base_price)}</p>
            <p className="pb-1 text-muted-foreground">{per}</p>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            {yearly ? `Equivale a ${brl(pro.base_price / 12)}/mês.` : "Sem fidelidade. Cancele quando quiser."}
          </p>
          <ul className="mx-auto mt-8 w-fit space-y-3">
            <Item strong>Tudo do Grátis, mais:</Item>
            {PRO_INCLUDES.map((f) => (
              <Item key={f}>{f}</Item>
            ))}
          </ul>
          <p className="mt-6 text-sm text-muted-foreground">Para 1 profissional. Se a equipe crescer, é só mudar para o Equipe.</p>
          <Button asChild className="mt-8 h-12 w-full text-base active:scale-95" data-testid="btn-plano-profissional">
            <Link href="/cadastro">Testar 15 dias grátis</Link>
          </Button>
        </div>

        {/* ---------- EQUIPE ---------- */}
        <div className="relative rounded-3xl border-2 border-[#C47B47] bg-card p-6 shadow-sm md:p-8" data-testid="card-plano-equipe">
          <span className="absolute -top-3 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-[#C47B47] px-3 py-1 text-xs font-semibold text-white">
            Para salões e equipes
          </span>
          <p className="text-sm font-semibold text-[#99582A]">Equipe</p>
          <div className="mt-3 flex items-end justify-center gap-2">
            <p className="font-heading text-5xl leading-none" data-testid="preco-total">{brl(teamTotal)}</p>
            <p className="pb-1 text-muted-foreground">{per}</p>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            {yearly ? `Equivale a ${brl(teamTotal / 12)}/mês.` : "Sem fidelidade. Cancele quando quiser."}
          </p>
          <ul className="mx-auto mt-8 w-fit space-y-3">
            <Item strong>Tudo do Profissional, mais:</Item>
            <Item>Até {included} profissionais inclusos</Item>
            {TEAM_INCLUDES.map((f) => (
              <Item key={f}>{f}</Item>
            ))}
          </ul>

          {/* Calculadora (só no Equipe) */}
          <div className="mt-8 rounded-2xl bg-secondary p-4">
            <p className="text-sm font-semibold">Quantas pessoas atendem no seu espaço?</p>
            <div className="mt-3 flex flex-col items-center gap-3">
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
                  : `${extras} ${extras === 1 ? "extra" : "extras"} × ${brl(team.extra_professional_price)} = ${brl(extras * team.extra_professional_price)}`}
              </p>
            </div>
            {teamMonthly && (
              <p className="mt-2 text-xs text-muted-foreground">
                Profissional extra: {brl(teamMonthly.extra_professional_price)}/mês por pessoa além de {included}.
              </p>
            )}
          </div>

          <Button asChild className="mt-8 h-12 w-full text-base active:scale-95" data-testid="btn-plano-teste">
            <Link href="/cadastro">Testar 15 dias grátis</Link>
          </Button>
        </div>
      </div>

      <p className="copy mt-8 text-sm text-muted-foreground">
        O teste de 15 dias é do plano Equipe, sem cartão. No fim, escolha o seu plano ou continue no Grátis.
      </p>
    </div>
  );
}
