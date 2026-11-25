// Cartão "Margem dos atendimentos" do Caixa (69). Receita = valor COBRADO dos atendimentos
// concluídos no período (68: pagamento parcial conta pelo cobrado), custo = foto do custo na
// conclusão. Atendimento sem custo não entra (aviso com link). Lucro estimado: só com a
// Calculadora de preço salva (Profissional e Equipe). Sem "use client": tela do servidor.
import Link from "next/link";
import { AlertTriangle, ChevronDown, Lock } from "lucide-react";
import { Ajuda } from "@/components/ajuda";
import { CATEGORY_LABEL, type CashCategory } from "@/lib/cash";
import { brl } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { MarginSummary } from "@/lib/margin-data";

export function MarginCard({
  data,
  calculatorAllowed,
}: {
  data: MarginSummary;
  /** plano Profissional+ (calculadora e lucro estimado) */
  calculatorAllowed: boolean;
}) {
  const empty = data.withCost === 0 && data.withoutCost === 0;
  const e = data.estimate;

  return (
    <section className="rounded-2xl border bg-card p-4 md:p-5" aria-labelledby="margem-titulo" data-testid="caixa-margem">
      <h2 id="margem-titulo" className="flex items-center gap-1 font-sans text-base font-semibold">
        Margem dos atendimentos <Ajuda id="margem-caixa" />
      </h2>

      {empty ? (
        <p className="mt-2 text-sm text-muted-foreground">Nenhum atendimento concluído no período.</p>
      ) : (
        <>
          <dl className="mt-3 grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
            <div className="min-w-0 rounded-xl bg-muted/60 p-3">
              <dt className="text-muted-foreground">Receita dos atendimentos</dt>
              <dd className="mt-1 break-words font-heading text-xl" data-testid="margem-receita">{brl(data.revenue)}</dd>
            </div>
            <div className="min-w-0 rounded-xl bg-muted/60 p-3">
              <dt className="text-muted-foreground">Custo direto</dt>
              <dd className="mt-1 break-words font-heading text-xl" data-testid="margem-custo">− {brl(data.cost)}</dd>
            </div>
            <div className="min-w-0 rounded-xl bg-secondary p-3">
              <dt className="text-muted-foreground">Margem bruta</dt>
              <dd className={cn("mt-1 break-words font-heading text-xl", data.margin < 0 && "text-destructive")} data-testid="margem-bruta">
                {brl(data.margin)}
                {data.marginPct !== null && <span className="ml-1 text-sm font-sans">({data.marginPct.toLocaleString("pt-BR")}%)</span>}
              </dd>
            </div>
          </dl>

          <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
            {data.withCost > 0 && (
              <li>
                {data.withCost} atendimento{data.withCost === 1 ? "" : "s"} com custo, pelo valor cobrado
                {data.packageSessions > 0 &&
                  ` · inclui ${data.packageSessions} sess${data.packageSessions === 1 ? "ão" : "ões"} de pacote (o valor entrou na venda)`}
              </li>
            )}
            {data.toReceive > 0 && <li data-testid="margem-a-receber">{brl(data.toReceive)} ainda a receber (Pagamento pendente)</li>}
          </ul>

          {data.withoutCost > 0 && (
            <p className="mt-3 flex gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" data-testid="margem-sem-custo">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span>
                {data.withoutCost} atendimento{data.withoutCost === 1 ? "" : "s"} sem custo cadastrado ({brl(data.revenueWithoutCost)}){" "}
                {data.withoutCost === 1 ? "ficou" : "ficaram"} fora da margem.{" "}
                <Link href="/admin/servicos" className="tap-target font-semibold underline" data-testid="link-margem-servicos">
                  Cadastrar em Serviços
                </Link>
              </span>
            </p>
          )}

          <div className="mt-4 border-t pt-4">
            {e ? (
              <div data-testid="margem-lucro">
                <p className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-semibold">Lucro estimado</span>
                  <span className={cn("font-heading text-2xl", e.profit < 0 && "text-destructive")}>{brl(e.profit)}</span>
                </p>
                <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">
                  <li>Margem bruta {brl(data.margin)}</li>
                  <li>− impostos {brl(e.taxes)}</li>
                  <li>− taxas da maquininha {brl(e.fees)}</li>
                  {e.commissions > 0 && <li>− comissões {brl(e.commissions)}</li>}
                  <li>
                    − custos fixos {brl(e.fixed)} ({e.days} dia{e.days === 1 ? "" : "s"})
                  </li>
                </ul>
                <p className="mt-2 text-xs text-muted-foreground">
                  Estimativa com as configurações da{" "}
                  <Link href="/admin/financeiro/preco" className="tap-target font-semibold text-primary underline">
                    Calculadora de preço
                  </Link>
                  . Para impostos, confirme com seu contador.
                </p>
              </div>
            ) : calculatorAllowed ? (
              <p className="text-sm text-muted-foreground">
                Quer ver o lucro estimado? Salve seus custos fixos e taxas na{" "}
                <Link href="/admin/financeiro/preco" className="tap-target font-semibold text-primary underline" data-testid="link-margem-calculadora">
                  Calculadora de preço
                </Link>
                .
              </p>
            ) : (
              <p className="flex items-center gap-1.5 text-sm text-muted-foreground" data-testid="margem-lucro-bloqueado">
                <Lock className="h-4 w-4 shrink-0 text-primary" aria-hidden />
                <span>
                  Lucro estimado e Calculadora de preço: planos Profissional e Equipe.{" "}
                  <Link href="/admin/assinatura" className="tap-target font-semibold text-primary underline">
                    Ver planos
                  </Link>
                </span>
              </p>
            )}
          </div>
        </>
      )}

      {data.otherIncome > 0 && <OtherIncome total={data.otherIncome} byCategory={data.otherByCategory} />}
    </section>
  );
}

// 70: nomes da divisão (categorias do caixa; "atendimento" aqui é lançamento avulso, sem agendamento)
const OTHER_LABEL: Record<string, string> = {
  pacote: "Pacotes",
  produtos: "Produtos",
  outros: "Outros",
  atendimento: "Atendimentos avulsos",
};

/** "Outras entradas do período" (70): entradas do caixa sem atendimento ligado; toque abre a divisão. */
function OtherIncome({ total, byCategory }: { total: number; byCategory: Record<string, number> }) {
  const rows = Object.entries(byCategory)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1]);
  return (
    <div className="mt-4 flex items-start gap-1 border-t pt-3" data-testid="margem-outras-entradas">
      <details className="group min-w-0 flex-1">
        <summary
          className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-sm [&::-webkit-details-marker]:hidden"
          data-testid="btn-margem-outras-entradas"
        >
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden />
          <span className="min-w-0">
            Outras entradas do período: <strong className="whitespace-nowrap">{brl(total)}</strong>{" "}
            <span className="text-muted-foreground">(não incluídas na margem)</span>
          </span>
        </summary>
        <ul className="mb-1 ml-6 space-y-1 text-sm text-muted-foreground" data-testid="margem-outras-divisao">
          {rows.map(([cat, v]) => (
            <li key={cat} className="flex justify-between gap-3">
              <span>{OTHER_LABEL[cat] ?? CATEGORY_LABEL[cat as CashCategory] ?? cat}</span>
              <span className="whitespace-nowrap">{brl(v)}</span>
            </li>
          ))}
        </ul>
      </details>
      <Ajuda id="margem-outras-entradas" />
    </div>
  );
}

/** Falha ao calcular (erro no banco): aviso discreto no lugar do cartão; o código vai para o log do servidor. */
export function MarginUnavailable() {
  return (
    <section className="rounded-2xl border bg-card p-4 md:p-5" aria-labelledby="margem-titulo" data-testid="caixa-margem-erro">
      <h2 id="margem-titulo" className="flex items-center gap-1 font-sans text-base font-semibold">
        Margem dos atendimentos <Ajuda id="margem-caixa" />
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">Não foi possível calcular a margem agora. Tente de novo em alguns minutos.</p>
    </section>
  );
}
