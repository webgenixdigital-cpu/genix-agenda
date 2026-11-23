// Carrinho do cartão de visita (Grátis e Básico): texto do pedido para o WhatsApp.
// Só tela; nada é salvo. Preço 0 = "valor a combinar" (o banco não tem "a partir de").

import { brl, duration } from "@/lib/format";

export type CartItem = { id: string; name: string; price: number; duration_min: number };

export type CartTotals = {
  count: number;
  /** soma dos serviços com preço */
  total: number;
  /** algum serviço sem preço (valor a combinar) */
  hasUnpriced: boolean;
  /** algum serviço com preço */
  hasPriced: boolean;
  minutes: number;
};

export const hasPrice = (price: number) => Number(price) > 0;

export function cartTotals(items: CartItem[]): CartTotals {
  const priced = items.filter((i) => hasPrice(i.price));
  return {
    count: items.length,
    total: priced.reduce((t, i) => t + Number(i.price), 0),
    hasUnpriced: priced.length < items.length,
    hasPriced: priced.length > 0,
    minutes: items.reduce((t, i) => t + (Number(i.duration_min) || 0), 0),
  };
}

/** "R$ 140,00", "a partir de R$ 60,00" ou null (nenhum com preço) */
export function cartTotalLabel(t: CartTotals): string | null {
  if (!t.hasPriced) return null;
  return t.hasUnpriced ? `a partir de ${brl(t.total)}` : brl(t.total);
}

export function buildCartMessage({ name, items }: { name?: string; items: CartItem[] }): string {
  const t = cartTotals(items);
  const who = (name ?? "").trim().replace(/\s+/g, " ").slice(0, 60);
  const lines: string[] = [];
  if (who) lines.push(`Olá! Meu nome é ${who}.`);
  lines.push(`${who ? "" : "Olá! "}Vi sua vitrine no Genix Agenda e gostaria de agendar:`);
  for (const i of items) {
    lines.push(`• ${i.name} — ${hasPrice(i.price) ? brl(i.price) : "valor a combinar"}`);
  }
  const total = cartTotalLabel(t);
  if (total) lines.push(`Total estimado: ${total}`);
  if (t.minutes > 0) lines.push(`Duração estimada: ${duration(t.minutes)}`);
  lines.push("Qual horário você tem disponível?");
  return lines.join("\n");
}
