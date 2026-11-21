// Planos para as páginas públicas ("/" e /para/[nicho]): leitura, tipos e FAQ.
// Valores sempre da tabela plans (migrations 28a/28b/52); nada de preço fixo no código.
import { brl } from "@/lib/format";
import { FREE_MONTHS, PLAN_PROMISE, TRIAL_DAYS } from "@/content/planos";

export type Plan = {
  id: string;
  name: string;
  billing_cycle: "MONTHLY" | "YEARLY";
  base_price: number;
  included_professionals: number;
  extra_professional_price: number;
  kind: "gratis" | "basico" | "profissional" | "equipe";
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

// ---------------------------------------------------------------------
// Cupom de lançamento (migration 53): oferta automática no prazo.
// Os preços vêm do banco (coupon_prices); nada fixo no código.
// ---------------------------------------------------------------------
export type LaunchOffer = {
  code: string;
  label: string;
  /** fim do prazo para assinar (ISO) */
  ends_at: string;
  duration_months: number;
  /** preço base com desconto por id de plano (só Profissional e Equipe) */
  prices: Record<string, number>;
};

export function normalizeOffer(raw: unknown): LaunchOffer | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const prices = Object.fromEntries(Object.entries((o.prices ?? {}) as Record<string, unknown>).map(([k, v]) => [k, Number(v)]));
  return {
    code: String(o.code),
    label: String(o.label),
    ends_at: String(o.ends_at),
    duration_months: Number(o.duration_months),
    prices,
  };
}

/** a oferta ainda vale agora? (as páginas públicas ficam em cache por até 1 h) */
export const offerOpen = (offer: LaunchOffer | null, now = Date.now()): offer is LaunchOffer =>
  !!offer && new Date(offer.ends_at).getTime() >= now;

/** "31/12/2026" (fim do prazo no fuso de São Paulo) */
export const offerEndLabel = (offer: LaunchOffer) =>
  new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric" }).format(
    new Date(offer.ends_at)
  );

/** preço com desconto de um plano (null = plano sem cupom) */
export const offerPrice = (offer: LaunchOffer | null, plan: Plan | undefined) =>
  offer && plan && offer.prices[plan.id] != null ? offer.prices[plan.id] : null;

/** Perguntas frequentes com os valores atuais (sem repetir a tabela) */
export function planFaq(plans: Plan[]) {
  const basicM = find(plans, "basico", "MONTHLY");
  const proM = find(plans, "profissional", "MONTHLY");
  const teamM = find(plans, "equipe", "MONTHLY");
  const teamY = find(plans, "equipe", "YEARLY");
  const included = teamM?.included_professionals ?? 3;

  return [
    {
      q: "Quanto tempo dura o plano Grátis?",
      a: `${FREE_MONTHS} meses a partir do cadastro (os ${TRIAL_DAYS} dias de teste do Equipe contam dentro). Inclui a agenda interna, clientes e ficha, 1 profissional e o cartão de visita: seu link com serviços, preços, avaliações e o botão “Agendar pelo WhatsApp”. ${PLAN_PROMISE.freeOver} O Básico custa${basicM ? ` ${brl(basicM.base_price)}/mês` : " pouco"}. Sem cartão.`,
    },
    {
      q: "Qual a diferença entre Básico, Profissional e Equipe?",
      a: `O Básico${basicM ? ` (${brl(basicM.base_price)}/mês)` : ""} tira o prazo e o selo e libera encaixe, bloqueios (almoço, folgas e férias), lembretes de véspera, recorrência e o financeiro com o relatório do contador; o link continua como cartão de visita. O Profissional${proM ? ` (${brl(proM.base_price)}/mês)` : ""} soma a vitrine com agendamento online 24h, confirmação automática, diretório, pedido de avaliação, retornos, pacotes, combos, metas e o WhatsApp automático. Os dois são para 1 profissional. O Equipe${teamM ? ` (${brl(teamM.base_price)}/mês)` : ""} tem tudo isso para até ${included} profissionais, com acesso individual para recepção e profissionais, comissões e salão-parceiro.`,
    },
    {
      q: "Quanto custa cada profissional a mais no Equipe?",
      a: teamM
        ? `O Equipe já inclui ${included} profissionais. A partir do ${included + 1}º, cada pessoa ativa soma ${brl(teamM.extra_professional_price)} por mês${teamY ? ` (ou ${brl(teamY.extra_professional_price)} no plano anual)` : ""}.`
        : `O Equipe já inclui ${included} profissionais; a partir daí, cada pessoa ativa tem um valor adicional.`,
    },
    {
      q: `O que acontece quando o teste de ${TRIAL_DAYS} dias acaba?`,
      a: `Você testa o plano Equipe por ${TRIAL_DAYS} dias, com tudo liberado, inclusive a vitrine de agendamento online, sem cartão. No fim, escolhe o Básico ou o Profissional (se atende sozinho) ou o Equipe. Se não assinar, a conta passa para o Grátis (agenda interna e cartão de visita), que vale até completar ${FREE_MONTHS} meses do cadastro, e nada é apagado.`,
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
