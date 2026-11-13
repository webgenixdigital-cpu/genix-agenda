"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export type SettingsSection = {
  /** âncora: /admin/configuracoes#<id> abre esta seção */
  id: string;
  title: string;
  /** estado atual em poucas palavras (ex.: "seg a sáb, 9h–19h") */
  summary: string;
  description: string;
  content: React.ReactNode;
};

const hashOf = (href: string) => {
  const i = href.indexOf("#");
  return i >= 0 ? decodeURIComponent(href.slice(i + 1)) : "";
};

/**
 * Seções recolhidas de Configurações: uma aberta por vez.
 * O conteúdo fica montado (só escondido), então salvar e o refresh da página
 * não fecham a seção nem apagam o que está sendo editado.
 */
export function SettingsAccordion({ sections }: { sections: SettingsSection[] }) {
  const [open, setOpen] = useState<string | null>(null);

  const openFromHash = useCallback(
    (hash: string, scroll: boolean) => {
      if (!sections.some((s) => s.id === hash)) return false;
      setOpen(hash);
      if (scroll)
        requestAnimationFrame(() => document.getElementById(hash)?.scrollIntoView({ behavior: "smooth", block: "start" }));
      return true;
    },
    [sections]
  );

  useEffect(() => {
    openFromHash(hashOf(window.location.href), true);
    const onHash = () => openFromHash(hashOf(window.location.href), true);
    // links internos (next/link) mudam o hash por pushState, sem "hashchange"
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a) return;
      const url = new URL(a.href, window.location.href);
      if (url.pathname !== window.location.pathname || !url.hash) return;
      openFromHash(hashOf(url.hash), true);
    };
    window.addEventListener("hashchange", onHash);
    window.addEventListener("popstate", onHash);
    document.addEventListener("click", onClick);
    return () => {
      window.removeEventListener("hashchange", onHash);
      window.removeEventListener("popstate", onHash);
      document.removeEventListener("click", onClick);
    };
  }, [openFromHash]);

  function toggle(id: string) {
    const next = open === id ? null : id;
    setOpen(next);
    // mantém o link da seção aberta (copiar e colar abre no mesmo lugar)
    const url = `${window.location.pathname}${window.location.search}${next ? `#${next}` : ""}`;
    window.history.replaceState(window.history.state, "", url);
  }

  return (
    <div className="space-y-3">
      {sections.map((s) => {
        const isOpen = open === s.id;
        const panelId = `secao-${s.id}-conteudo`;
        return (
          <section key={s.id} id={s.id} className="scroll-mt-4 rounded-2xl border bg-card">
            <h2 className="font-sans text-base">
              <button
                type="button"
                className="flex min-h-11 w-full items-center gap-3 rounded-2xl px-4 py-3 text-left md:px-6 md:py-4"
                aria-expanded={isOpen}
                aria-controls={panelId}
                onClick={() => toggle(s.id)}
                data-testid={`secao-config-${s.id}`}
              >
                <span className="min-w-0 flex-1">
                  <span className="block font-heading text-lg md:text-xl">{s.title}</span>
                  <span className="block break-words text-sm text-muted-foreground">{s.summary}</span>
                </span>
                <ChevronDown
                  className={cn("h-5 w-5 shrink-0 text-muted-foreground transition-transform", isOpen && "rotate-180")}
                  aria-hidden
                />
              </button>
            </h2>
            <div id={panelId} role="region" aria-label={s.title} hidden={!isOpen} className="border-t px-4 pb-5 pt-4 md:px-6 md:pb-6">
              <p className="mb-5 text-sm text-muted-foreground">{s.description}</p>
              {s.content}
            </div>
          </section>
        );
      })}
    </div>
  );
}
