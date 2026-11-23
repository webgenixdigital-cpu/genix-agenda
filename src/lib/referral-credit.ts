// Indicação com crédito proporcional (migration 61): contas puras, sem banco nem Asaas.
// Pode ir para qualquer lugar (servidor, testes). A regra de verdade fica no banco
// (referral_monthly_value, índice de 1 crédito por cobrança) e em lib/referral.ts.

/** menor cobrança aceita pelo Asaas (R$). Igual a MIN_CHARGE de lib/billing.ts. */
export const MIN_PAYMENT_VALUE = 5;

const cents = (n: number) => Math.round(n * 100);
const round2 = (n: number) => cents(n) / 100;

/** mensalidade de um valor: anual ÷ 12, arredondado para baixo no centavo (como no banco) */
export function monthlyOf(total: number, cycle: "MONTHLY" | "YEARLY") {
  return cycle === "YEARLY" ? Math.floor(cents(total) / 12) / 100 : round2(total);
}

export type CreditDecision =
  | { as: "adiamento"; referrerMonthly: number; credit: number }
  | { as: "reducao"; referrerMonthly: number; credit: number; before: number; after: number };

/**
 * Como um crédito sai na cobrança de quem indicou.
 * referredMonthly: mensalidade paga pelo indicado (já ÷ 12 se anual);
 * chargeTotal: preço da cobrança de quem indicou pelo vencimento dela (com cupom), sem créditos;
 * cycle: ciclo de quem indicou (anual: a mensalidade é a renovação ÷ 12).
 * crédito = menor dos dois; crédito >= mensalidade → adia 1 mês; cobrança abaixo de R$ 5 → adia 1 mês.
 */
export function decideCredit(referredMonthly: number, chargeTotal: number, cycle: "MONTHLY" | "YEARLY"): CreditDecision {
  const referrerMonthly = monthlyOf(chargeTotal, cycle);
  const credit = Math.min(round2(referredMonthly), referrerMonthly);
  if (cents(credit) >= cents(referrerMonthly)) return { as: "adiamento", referrerMonthly, credit: referrerMonthly };
  const after = round2(chargeTotal - credit);
  if (cents(after) < cents(MIN_PAYMENT_VALUE)) return { as: "adiamento", referrerMonthly, credit: referrerMonthly };
  return { as: "reducao", referrerMonthly, credit, before: round2(chargeTotal), after };
}

/**
 * Valor esperado de uma cobrança = preço do vencimento − créditos de indicação ligados a ela.
 * Usado em applySubscriptionValues e na rede de segurança do webhook: assim sincronizar,
 * trocar de plano ou adiar nunca apagam nem duplicam o crédito (o valor é sempre absoluto).
 * Se o preço cair depois (troca de plano), a cobrança nunca fica abaixo de R$ 5.
 */
export function expectedPaymentValue(quoteTotal: number, credit: number) {
  if (!(credit > 0)) return round2(quoteTotal);
  return Math.max(round2(quoteTotal - credit), Math.min(round2(quoteTotal), MIN_PAYMENT_VALUE));
}
