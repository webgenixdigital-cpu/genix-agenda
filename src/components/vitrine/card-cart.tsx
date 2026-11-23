"use client";

// Carrinho do cartão de visita (Grátis e Básico): a cliente escolhe um ou mais serviços
// e manda o pedido pronto pelo WhatsApp. Seleção só em memória; nada vai para o banco.
// O cartão não consulta a agenda: o espaço combina o horário (da soma dos serviços) na conversa.

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { Check, MessageCircle, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { whatsappLink } from "@/lib/format";
import { buildCartMessage, cartTotalLabel, cartTotals, type CartItem } from "@/lib/cart-message";

type Ctx = {
  selected: CartItem[];
  isSelected: (id: string) => boolean;
  toggle: (item: CartItem) => void;
  clear: () => void;
};

const CartContext = createContext<Ctx | null>(null);

function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart fora do CardCartProvider");
  return ctx;
}

/**
 * Envolve a vitrine no modo cartão. Mostra a barra do pedido (com 1+ serviço) ou,
 * sem nada escolhido, o botão flutuante de sempre (conversa genérica).
 */
export function CardCartProvider({
  whatsapp,
  floatingHref,
  children,
}: {
  whatsapp: string | null;
  /** link do flutuante de sempre (mensagem padrão do espaço) */
  floatingHref: string | null;
  children: ReactNode;
}) {
  // ordem da escolha = ordem na mensagem
  const [selected, setSelected] = useState<CartItem[]>([]);

  const value = useMemo<Ctx>(
    () => ({
      selected,
      isSelected: (id) => selected.some((s) => s.id === id),
      toggle: (item) =>
        setSelected((cur) => (cur.some((s) => s.id === item.id) ? cur.filter((s) => s.id !== item.id) : [...cur, item])),
      clear: () => setSelected([]),
    }),
    [selected]
  );

  return (
    <CartContext.Provider value={value}>
      {children}
      {whatsapp && selected.length > 0 ? (
        <CardCartBar whatsapp={whatsapp} />
      ) : floatingHref ? (
        <a
          href={floatingHref}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Conversar no WhatsApp"
          data-testid="btn-whatsapp-flutuante"
          className="fixed bottom-5 right-5 z-40 grid h-14 w-14 place-items-center rounded-full bg-whatsapp text-white shadow-lg transition-transform hover:bg-whatsapp-hover active:scale-95"
        >
          <MessageCircle className="h-7 w-7" />
        </a>
      ) : null}
    </CartContext.Provider>
  );
}

/** Botão “Adicionar” / “Adicionado” de cada serviço do cartão */
export function CardServiceToggle({ item }: { item: CartItem }) {
  const { isSelected, toggle } = useCart();
  const on = isSelected(item.id);
  return (
    <Button
      type="button"
      variant={on ? "default" : "outline"}
      aria-pressed={on}
      aria-label={on ? `Tirar ${item.name} do pedido` : `Adicionar ${item.name} ao pedido`}
      onClick={() => toggle(item)}
      className="h-11 min-w-[132px] shrink-0 active:scale-95"
      data-testid={`btn-carrinho-${item.id}`}
    >
      {on ? <Check className="mr-1.5 h-4 w-4" /> : <Plus className="mr-1.5 h-4 w-4" />}
      {on ? "Adicionado" : "Adicionar"}
    </Button>
  );
}

function CardCartBar({ whatsapp }: { whatsapp: string }) {
  const { selected, clear } = useCart();
  const [name, setName] = useState("");
  const t = cartTotals(selected);
  const total = cartTotalLabel(t);
  const href = whatsappLink(whatsapp, buildCartMessage({ name, items: selected })) ?? "#";

  return (
    <>
      {/* espaço no fim da página para a barra não cobrir o conteúdo */}
      <div aria-hidden className="h-52" />
      <div
        role="region"
        aria-label="Seu pedido"
        data-testid="barra-carrinho"
        className="fixed inset-x-0 bottom-0 z-50 border-t bg-card shadow-[0_-8px_24px_rgba(28,25,23,0.12)] md:inset-x-auto md:left-1/2 md:w-full md:max-w-xl md:-translate-x-1/2 md:rounded-t-2xl md:border-x"
      >
        <div className="space-y-2.5 px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3">
          <div className="flex items-center gap-2">
            <p className="min-w-0 flex-1 text-sm" aria-live="polite" data-testid="carrinho-resumo">
              <strong>{t.count} {t.count === 1 ? "serviço" : "serviços"}</strong>
              {total && (
                <>
                  {" · "}Total estimado <strong>{total}</strong>
                </>
              )}
            </p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={clear}
              className="tap-target shrink-0 text-muted-foreground"
              data-testid="btn-carrinho-limpar"
            >
              <X className="mr-1 h-4 w-4" /> Limpar
            </Button>
          </div>
          <div>
            <Label htmlFor="carrinho-nome" className="sr-only">Seu nome (opcional)</Label>
            <Input
              id="carrinho-nome"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Seu nome (opcional)"
              autoComplete="given-name"
              maxLength={60}
              className="h-11"
              data-testid="input-carrinho-nome"
            />
          </div>
          <Button asChild size="lg" className="h-12 w-full bg-whatsapp text-base text-white hover:bg-whatsapp-hover active:scale-95">
            <a href={href} target="_blank" rel="noopener noreferrer" data-testid="btn-carrinho-whatsapp">
              <MessageCircle className="mr-2 h-5 w-5" /> Pedir pelo WhatsApp
            </a>
          </Button>
          <p className="text-center text-xs text-muted-foreground">O horário é combinado com o espaço pelo WhatsApp.</p>
        </div>
      </div>
    </>
  );
}
