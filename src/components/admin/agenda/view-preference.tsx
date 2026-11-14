"use client";

import { useEffect, useRef } from "react";
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

/** "2026-11-14" no fuso informado, calculado no navegador */
function todayIn(timeZone: string) {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date());
  } catch {
    return todayISO();
  }
}

/**
 * today = "hoje" calculado no servidor no fuso do espaço.
 * Aba/app deixado aberto de um dia para o outro: ao voltar para a tela (ou a cada minuto),
 * se o dia virou e a URL não traz data escolhida, recarrega para abrir em hoje.
 */
export function ViewPreference({ view, today, timeZone }: { view: AgendaView; today: string; timeZone: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const explicit = params.get("visao");
  const pinned = !!(params.get("data") || params.get("calendario"));
  // 1 recarga por dia novo (relógio do aparelho errado não vira um laço de recargas)
  const refreshedFor = useRef<string | null>(null);

  useEffect(() => {
    if (pinned) return;
    const check = () => {
      if (document.visibilityState !== "visible") return;
      const now = todayIn(timeZone);
      if (now !== today && refreshedFor.current !== now) {
        refreshedFor.current = now;
        router.refresh();
      }
    };
    check();
    document.addEventListener("visibilitychange", check);
    window.addEventListener("focus", check);
    const t = setInterval(check, 60_000);
    return () => {
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("focus", check);
      clearInterval(t);
    };
  }, [pinned, today, timeZone, router]);

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
      p.set("calendario", data.slice(0, 7) || today.slice(0, 7));
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
  }, [view, explicit, params, pathname, router, today]);

  return null;
}
