"use client";

import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

// Lembra a última visão da Agenda (Dia | Semana) neste navegador.
// Celular (< 768 px) fica sempre no Dia.
const KEY = "genix:agenda-visao";
export const WEEK_MEDIA = "(min-width: 768px)";

export function saveView(view: "dia" | "semana") {
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

export function ViewPreference({ view }: { view: "dia" | "semana" }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const explicit = params.get("visao");

  useEffect(() => {
    const wide = window.matchMedia(WEEK_MEDIA).matches;
    const p = new URLSearchParams(params.toString());
    if (view === "semana" && !wide) {
      p.set("visao", "dia");
      router.replace(`${pathname}?${p.toString()}`);
    } else if (!explicit && !params.get("status") && wide && savedView() === "semana") {
      p.set("visao", "semana");
      router.replace(`${pathname}?${p.toString()}`);
    }
  }, [view, explicit, params, pathname, router]);

  return null;
}
