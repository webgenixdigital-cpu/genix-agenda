"use client";

import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { todayISO } from "@/lib/dates";

// Lembra a última visão da Agenda (Dia | Semana | Mês) neste navegador.
// Celular (< 768 px) fica sempre no Dia; o Mês abre lá como janela tela cheia (?calendario=yyyy-mm).
const KEY = "genix:agenda-visao";
export const WEEK_MEDIA = "(min-width: 768px)";

export type AgendaView = "dia" | "semana" | "mes";

export function saveView(view: AgendaView) {
  try {
    localStorage.setItem(KEY, view);
  } catch {
    // modo privado / armazenamento bloqueado: só não lembra
  }
}

function savedView() {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function ViewPreference({ view }: { view: AgendaView }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const explicit = params.get("visao");

  useEffect(() => {
    const wide = window.matchMedia(WEEK_MEDIA).matches;
    const p = new URLSearchParams(params.toString());
    const saved = savedView();
    if (view === "semana" && !wide) {
      p.set("visao", "dia");
      router.replace(`${pathname}?${p.toString()}`);
    } else if (view === "mes" && !wide) {
      // link do Mês aberto no celular: Dia + calendário tela cheia
      const data = p.get("data") ?? "";
      p.set("visao", "dia");
      p.set("calendario", data.slice(0, 7) || todayISO().slice(0, 7));
      p.delete("data");
      router.replace(`${pathname}?${p.toString()}`);
    } else if (view === "dia" && wide && params.get("calendario")) {
      // calendário do celular aberto numa tela larga: vira a visão Mês
      p.set("visao", "mes");
      p.set("data", params.get("calendario")!);
      p.delete("calendario");
      router.replace(`${pathname}?${p.toString()}`);
    } else if (!explicit && !params.get("status") && !params.get("calendario") && wide && (saved === "semana" || saved === "mes")) {
      p.set("visao", saved);
      if (saved === "mes" && p.get("data")) p.set("data", p.get("data")!.slice(0, 7));
      router.replace(`${pathname}?${p.toString()}`);
    }
  }, [view, explicit, params, pathname, router]);

  return null;
}
