// Indique e ganhe (migration 56): constantes e textos que podem ir para qualquer tela
// (sem chave de serviço). A regra de verdade fica no banco e em lib/referral.ts.

/** cookie que guarda o código de quem indicou por 30 dias (gravado no middleware) */
export const REFERRAL_COOKIE = "genix_ind";
export const REFERRAL_COOKIE_DAYS = 30;

/** 8 caracteres, sem 0/O/1/I (gen_referral_code no banco) */
export const isReferralCode = (v: string | null | undefined): v is string => !!v && /^[A-HJ-NP-Z2-9]{8}$/i.test(v);

/** link de indicação: a página de cadastro com o código */
export const referralLink = (origin: string, code: string) => `${origin.replace(/\/$/, "")}/cadastro?ind=${code}`;

/** mensagem pronta do botão “Compartilhar no WhatsApp” */
export const referralShareText = (businessName: string, link: string) =>
  `Oi! Eu uso o Genix Agenda no ${businessName} para a agenda online e a vitrine. Os clientes marcam sozinhos e eu paro de viver no WhatsApp. Crie a sua conta grátis por este link: ${link}`;

/** situação de cada indicação no card (sem dados pessoais) */
export type ReferralItem = {
  name: string;
  created_at: string;
  status: "cadastrou" | "assinou" | "pagou" | "premio";
  reward: "guardado" | "aplicado" | "cancelado" | "bloqueado" | null;
  due_after: string | null;
  /** 61: 'mes' (1 mês grátis, regra antiga) | 'credito'; como saiu; valor do crédito usado */
  kind?: "mes" | "credito" | null;
  applied_as?: "reducao" | "adiamento" | null;
  credit_amount?: number | string | null;
};

/** resumo dos prêmios de quem indicou (my_referrals) */
export type ReferralRewards = {
  guardado: number;
  aplicado: number;
  /** meses grátis usados (regra antiga + créditos que cobriram a mensalidade) */
  meses_aplicados: number;
  /** soma dos créditos que reduziram cobranças (R$) */
  credito_aplicado: number;
};

const money = (v: number | string) => Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function referralStatusLabel(i: ReferralItem) {
  if (i.reward === "aplicado") {
    if (i.applied_as === "reducao" && i.credit_amount != null) return `Crédito de ${money(i.credit_amount)} · usado`;
    if (i.kind === "credito" || i.kind === "mes") return "1 mês grátis · usado";
    return "Prêmio concedido · usado";
  }
  if (i.reward === "guardado") return i.kind === "credito" ? "Crédito guardado" : "Prêmio concedido · guardado";
  if (i.reward === "cancelado") return "Prêmio cancelado (estorno)";
  if (i.reward === "bloqueado") return "Pagou · sem prêmio";
  if (i.status === "pagou") return "Pagou";
  if (i.status === "assinou") return "Assinou";
  return "Cadastrou";
}
