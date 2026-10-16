"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { Check, ChevronDown, Loader2, PartyPopper, X } from "lucide-react";
import { toast } from "sonner";
import {
  addSuggestedServices, markOnboardingStep, setOnboardingDismissed, type ManualStep,
} from "@/app/admin/(painel)/onboarding/actions";
import { Button } from "@/components/ui/button";
import type { OnboardingItem } from "@/lib/onboarding";
import { cn } from "@/lib/utils";

type Props = {
  items: OnboardingItem[];
  doneCount: number;
  total: number;
  dismissed: boolean;
  slug: string;
  welcome: boolean;
  ownerName?: string | null;
};

export function OnboardingCard({ items, doneCount, total, dismissed, slug, welcome, ownerName }: Props) {
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [origin, setOrigin] = useState("");
  const [showDone, setShowDone] = useState(false);

  useEffect(() => setOrigin(window.location.origin), []);

  const allDone = doneCount >= total;
  const pct = Math.round((doneCount / total) * 100);
  const nextKey = items.find((i) => !i.done && !i.optional)?.key;

  // ---------------------------------------------------------------
  // Card fechado: só um link para reabrir
  // ---------------------------------------------------------------
  if (dismissed) {
    return (
      <button
        className="text-sm font-semibold text-primary underline"
        disabled={pending}
        onClick={() => start(async () => { await setOnboardingDismissed(false); })}
        data-testid="btn-reabrir-onboarding"
      >
        Ver primeiros passos ({doneCount} de {total})
      </button>
    );
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
    <section className="rounded-2xl border-2 border-primary/30 bg-card p-5 md:p-6" data-testid="card-onboarding">
      {/* Cabeçalho */}
      <div className="flex items-start justify-between gap-4">
        <div>
          {welcome && (
            <p className="mb-1 text-sm font-semibold text-primary">
              Boas-vindas{ownerName ? `, ${ownerName.split(" ")[0]}` : ""}! Sua conta está criada.
            </p>
          )}
          <h2 className="text-2xl">{allDone ? "Tudo pronto!" : "Primeiros passos"}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {allDone
              ? "Sua vitrine está preparada para receber agendamentos."
              : "Siga a lista para deixar sua vitrine pronta para receber clientes."}
          </p>
        </div>
        {allDone && (
          <Button
            variant="ghost"
            size="icon"
            className="h-10 w-10 shrink-0"
            aria-label="Fechar primeiros passos"
            onClick={() => run("dismiss", () => setOnboardingDismissed(true))}
            data-testid="btn-fechar-onboarding"
          >
            <X className="h-5 w-5" />
          </Button>
        )}
      </div>

      {/* Progresso */}
      <div className="mt-4">
        <div className="flex justify-between text-sm">
          <span className="font-semibold">{doneCount} de {total} concluídos</span>
          <span className="text-muted-foreground">{pct}%</span>
        </div>
        <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-secondary" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full rounded-full bg-primary transition-all duration-500" style={{ width: `${pct}%` }} />
        </div>
      </div>

      {allDone ? (
        <div className="mt-5 flex items-center gap-3 rounded-xl bg-green-50 p-4 text-green-900">
          <PartyPopper className="h-6 w-6 shrink-0" />
          <p className="text-sm">Parabéns! Continue divulgando seu link para os pedidos chegarem.</p>
        </div>
      ) : (
        <ol className="mt-5 space-y-3">
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
      )}

      {!allDone && doneCount > 0 && (
        <button
          className="mt-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          onClick={() => setShowDone(!showDone)}
        >
          <ChevronDown className={cn("h-4 w-4 transition-transform", showDone && "rotate-180")} />
          {showDone ? "Esconder concluídos" : `Mostrar concluídos (${doneCount})`}
        </button>
      )}
    </section>
  );
}
