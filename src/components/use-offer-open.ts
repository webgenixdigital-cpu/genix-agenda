"use client";

import { useEffect, useState } from "react";
import { offerOpen, type LaunchOffer } from "@/lib/plans-public";

/**
 * Cupom de lançamento (53): a oferta ainda vale no relógio do navegador?
 * As páginas públicas ficam em cache por até 1 h; o servidor já filtra pelo prazo,
 * e aqui a oferta some sozinha quando o prazo passa com a página aberta.
 * Começa como o servidor mandou (sem diferença na hidratação).
 */
export function useOfferOpen(offer: LaunchOffer | null): LaunchOffer | null {
  const [open, setOpen] = useState(!!offer);
  useEffect(() => {
    if (!offer) return;
    const check = () => setOpen(offerOpen(offer));
    check();
    const ms = new Date(offer.ends_at).getTime() - Date.now();
    if (ms <= 0 || ms > 2_147_000_000) return;
    const t = setTimeout(check, ms + 1000);
    return () => clearTimeout(t);
  }, [offer]);
  return open ? offer : null;
}
