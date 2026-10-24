// Rótulos do caixa (usados no servidor e no navegador)
export type CashCategory = "atendimento" | "pacote" | "comissao" | "produtos" | "aluguel" | "outros";
export type CashMethod = "pix" | "dinheiro" | "credito" | "debito";

export const CATEGORY_LABEL: Record<CashCategory, string> = {
  atendimento: "Atendimento",
  pacote: "Pacote",
  comissao: "Comissão",
  produtos: "Produtos",
  aluguel: "Aluguel e contas",
  outros: "Outros",
};

export const METHOD_LABEL: Record<CashMethod, string> = {
  pix: "Pix",
  dinheiro: "Dinheiro",
  credito: "Cartão de crédito",
  debito: "Cartão de débito",
};