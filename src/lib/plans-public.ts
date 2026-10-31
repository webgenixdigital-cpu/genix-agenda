// Planos para as páginas públicas ("/" e /para/[nicho]): leitura, tipos e FAQ.
// Valores sempre da tabela plans (migrations 28a/28b); nada de preço fixo no código.
import { brl } from "@/lib/format";

export type Plan = {
  id: string;
  name: string;
  billing_cycle: "MONTHLY" | "YEARLY";
  base_price: number;
  included_professionals: number;
  extra_professional_price: number;
  kind: "gratis" | "profissional" | "equipe";
  online_daily_limit: number | null;
};

/** colunas lidas da tabela plans */
export const PLAN_COLUMNS =
  "id, name, billing_cycle, base_price, included_professionals, extra_professional_price, kind, online_daily_limit";

export function normalizePlans(rows: Record<string, unknown>[] | null): Plan[] {
  return (rows ?? []).map((p) => ({
    ...(p as unknown as Plan),
    base_price: Number(p.base_price),
    extra_professional_price: Number(p.extra_professional_price),
  }));
}

const find = (plans: Plan[], kind: Plan["kind"], cycle: Plan["billing_cycle"]) =>
  plans.find((p) => p.kind === kind && p.billing_cycle === cycle);

/** Perguntas frequentes com os valores atuais (sem repetir a tabela) */
export function planFaq(plans: Plan[]) {
  const limit = plans.find((p) => p.kind === "gratis")?.online_daily_limit ?? 6;
  const proM = find(plans, "profissional", "MONTHLY");
  const teamM = find(plans, "equipe", "MONTHLY");
  const teamY = find(plans, "equipe", "YEARLY");
  const included = teamM?.included_professionals ?? 3;

  return [
    {
      q: "O plano Grátis é para sempre mesmo?",
      a: `Sim. Vitrine com link próprio, agenda online com até ${limit} agendamentos online por dia, 1 profissional, ficha dos clientes, avaliações e lembretes de véspera em um toque. Sem prazo para acabar e sem cartão.`,
    },
    {
      q: "Qual a diferença entre o Profissional e o Equipe?",
      a: `O Profissional${proM ? ` (${brl(proM.base_price)}/mês)` : ""} libera tudo para quem atende sozinho: agendamentos ilimitados, bloqueios, recorrência, pacotes, retornos, financeiro e relatório do contador. O Equipe${teamM ? ` (${brl(teamM.base_price)}/mês)` : ""} tem tudo isso para até ${included} profissionais, com acesso individual para recepção e profissionais, comissões e salão-parceiro.`,
    },
    {
      q: "Quanto custa cada profissional a mais no Equipe?",
      a: teamM
        ? `O Equipe já inclui ${included} profissionais. A partir do ${included + 1}º, cada pessoa ativa soma ${brl(teamM.extra_professional_price)} por mês${teamY ? ` (ou ${brl(teamY.extra_professional_price)} no plano anual)` : ""}.`
        : `O Equipe já inclui ${included} profissionais; a partir daí, cada pessoa ativa tem um valor adicional.`,
    },
    {
      q: "O que acontece quando o teste de 15 dias acaba?",
      a: "Você testa o plano Equipe por 15 dias, sem cartão. No fim, escolhe o Profissional (se atende sozinho) ou o Equipe. Se não assinar, a conta passa para o Grátis e nada é apagado.",
    },
    {
      q: "Quais formas de pagamento são aceitas?",
      a: "Pix e cartão de crédito, com cobrança recorrente mensal ou anual.",
    },
    {
      q: "Tem fidelidade?",
      a: "Não. No mensal, cancele quando quiser. O anual é pago uma vez por ano e sai com 2 meses grátis.",
    },
  ];
}
