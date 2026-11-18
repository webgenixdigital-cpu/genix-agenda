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
};

export function referralStatusLabel(i: ReferralItem) {
  if (i.reward === "aplicado") return "Prêmio concedido · usado";
  if (i.reward === "guardado") return "Prêmio concedido · guardado";
  if (i.reward === "cancelado") return "Prêmio cancelado (estorno)";
  if (i.reward === "bloqueado") return "Pagou · sem prêmio";
  if (i.status === "pagou") return "Pagou";
  if (i.status === "assinou") return "Assinou";
  return "Cadastrou";
}
