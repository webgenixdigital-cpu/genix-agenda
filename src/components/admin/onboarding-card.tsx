"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { Check, ChevronDown, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { addSuggestedServices, markOnboardingStep, type ManualStep } from "@/app/admin/(painel)/onboarding/actions";
import { Button } from "@/components/ui/button";
import type { OnboardingItem } from "@/lib/onboarding";
import { ONBOARDING_COOKIE, setPrefCookie } from "@/lib/ui-prefs";
import { cn } from "@/lib/utils";

type Props = {
  items: OnboardingItem[];
  doneCount: number;
  total: number;
  /** vem do cookie genix_onboarding (lido no servidor) */
  initialExpanded: boolean;
  slug: string;
  welcome: boolean;
  ownerName?: string | null;
};

// Só aparece com passos pendentes e sem "Ocultar" (o Início decide pelo cookie)
export function OnboardingCard({ items, doneCount, total, initialExpanded, slug, welcome, ownerName }: Props) {
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [origin, setOrigin] = useState("");
  const [showDone, setShowDone] = useState(false);
  const [expanded, setExpanded] = useState(initialExpanded);
  const [hidden, setHidden] = useState(false);

  useEffect(() => setOrigin(window.location.origin), []);

  const pct = Math.round((doneCount / total) * 100);
  const nextKey = items.find((i) => !i.done && !i.optional)?.key;

  if (hidden) return null;

  function toggle() {
    const next = !expanded;
    setExpanded(next);
    setPrefCookie(ONBOARDING_COOKIE, next ? "expanded" : null);
  }

  function hide() {
    setPrefCookie(ONBOARDING_COOKIE, "hidden");
    setHidden(true);
    toast.success("Configuração inicial oculta. Para rever, vá em Configurações.");
  }

  function run(key: string, fn: () => Promise<{ ok: boolean; error?: string; message?: string } | undefined>, success?: string) {
    setBusy(key);
    start(async () => {
      const r = await fn();
      setBusy(null);
      if (!r) return; // demonstração: o servidor redirecionou
      if (r.ok) {
        const msg = r.message ?? success;
        if (msg) toast.success(msg);
      } else toast.error(r.error);
    });
  }

  async function copyLink(item: OnboardingItem) {
    const url = `${origin}/v/${slug}`;
    await navigator.clipboard.writeText(url);
    toast.success("Link copiado. Agora é só colar na bio e no status.");
    if (!item.done && item.step) run(item.key, () => markOnboardingStep(item.step as ManualStep));
  }

  const visible = showDone ? items : items.filter((i) => !i.done);

  return (
    <section
      className="rounded-2xl border-2 border-primary/30 bg-card p-4 md:p-5"
      data-testid="card-onboarding"
      data-state={expanded ? "expanded" : "collapsed"}
    >
      {welcome && (
        <p className="mb-3 text-center text-sm font-semibold text-primary">
          Boas-vindas{ownerName ? `, ${ownerName.split(" ")[0]}` : ""}! Sua conta está criada.
        </p>
      )}

      {/* Barra compacta: progresso + ações */}
      <div className="flex flex-col items-center gap-4 text-center">
        <div className="w-full min-w-0">
          <div className="flex flex-wrap items-baseline justify-center gap-x-3 gap-y-1">
            <h2 className="text-lg leading-tight" data-testid="onboarding-resumo">
              Configuração inicial: {doneCount} de {total} concluídos
            </h2>
            <span className="text-sm text-muted-foreground">{pct}%</span>
          </div>
          <div
            className="mt-2 h-2 overflow-hidden rounded-full bg-secondary"
            role="progressbar"
            aria-label="Progresso da configuração inicial"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div className="h-full rounded-full bg-primary transition-all duration-500" style={{ width: `${pct}%` }} />
          </div>
        </div>
        <div className="flex shrink-0 justify-center gap-2">
          <Button
            variant={expanded ? "outline" : "default"}
            className="h-11"
            onClick={toggle}
            aria-expanded={expanded}
            aria-controls="onboarding-passos"
            data-testid="btn-ver-passos"
          >
            {expanded ? "Recolher" : "Ver passos"}
            <ChevronDown className={cn("h-4 w-4 transition-transform", expanded && "rotate-180")} />
          </Button>
          <Button variant="ghost" className="h-11" onClick={hide} data-testid="btn-ocultar-onboarding">
            Ocultar
          </Button>
        </div>
      </div>

      {expanded && (
        <div id="onboarding-passos">
          <p className="mt-5 text-center text-sm text-muted-foreground">Siga a lista para deixar sua vitrine pronta para receber clientes.</p>
          <ol className="mt-4 space-y-3">
            {visible.map((item) => {
              const isNext = item.key === nextKey;
              const n = items.indexOf(item) + 1;
              return (
                <li
                  key={item.key}
                  className={cn(
                    "rounded-xl border p-4 transition-colors",
                    item.done ? "bg-stone-50" : isNext ? "border-primary bg-primary/5" : "bg-white"
                  )}
                  data-testid={`onboarding-${item.key}`}
                >
                  <div className="flex gap-3">
                    <span
                      className={cn(
                        "grid h-7 w-7 shrink-0 place-items-center rounded-full text-sm font-semibold",
                        item.done ? "bg-green-600 text-white" : isNext ? "bg-primary text-primary-foreground" : "bg-secondary"
                      )}
                      aria-hidden
                    >
                      {item.done ? <Check className="h-4 w-4" /> : n}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className={cn("font-semibold", item.done && "text-muted-foreground line-through")}>
                        {item.title}
                        {item.optional && <span className="ml-2 text-xs font-normal text-muted-foreground">(opcional)</span>}
                      </p>
                      {!item.done && <p className="mt-0.5 text-sm text-muted-foreground">{item.why}</p>}

                      {!item.done && (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {item.href && (
                            <Button asChild size="sm" variant={isNext ? "default" : "outline"} className="h-10">
                              {item.href.startsWith("/v/") ? (
                                <a href={item.href} target="_blank" rel="noopener noreferrer">{item.hrefLabel}</a>
                              ) : (
                                <Link href={item.href}>{item.hrefLabel}</Link>
                              )}
                            </Button>
                          )}
                          {item.action && (
                            <Button
                              size="sm"
                              variant={item.href ? "ghost" : isNext ? "default" : "outline"}
                              className="h-10"
                              disabled={pending}
                              data-testid={`onboarding-acao-${item.key}`}
                              onClick={() => {
                                if (item.action === "copy") copyLink(item);
                                else if (item.action === "suggest") run(item.key, () => addSuggestedServices());
                                else if (item.step) run(item.key, () => markOnboardingStep(item.step as ManualStep), "Passo concluído");
                              }}
                            >
                              {busy === item.key ? <Loader2 className="h-4 w-4 animate-spin" /> : item.actionLabel}
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>

          {doneCount > 0 && (
            <button
              className="mt-2 inline-flex min-h-11 items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
              onClick={() => setShowDone(!showDone)}
              data-testid="btn-mostrar-concluidos"
            >
              <ChevronDown className={cn("h-4 w-4 transition-transform", showDone && "rotate-180")} />
              {showDone ? "Esconder concluídos" : `Mostrar concluídos (${doneCount})`}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
