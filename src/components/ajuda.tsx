"use client";

import { useSyncExternalStore } from "react";
import { HelpCircle } from "lucide-react";
import { AJUDA, type AjudaId, type AjudaItem } from "@/content/ajuda";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

// Computador (≥ 768 px): janelinha ao lado do "?". Celular: folha que sobe de baixo.
const DESKTOP = "(min-width: 768px)";
function subscribe(cb: () => void) {
  const m = window.matchMedia(DESKTOP);
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
}
const useDesktop = () =>
  useSyncExternalStore(
    subscribe,
    () => window.matchMedia(DESKTOP).matches,
    () => false
  );

function Corpo({ item, comTitulo }: { item: AjudaItem; comTitulo: boolean }) {
  return (
    <div className="space-y-3 text-left text-sm">
      {comTitulo && <p className="pr-6 font-heading text-lg leading-tight">{item.titulo}</p>}
      <div className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-primary">Para que serve</p>
        <p className="text-foreground">{item.serve}</p>
      </div>
      <div className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-primary">Como fazer</p>
        <ol className="list-decimal space-y-1 pl-5">
          {item.passos.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ol>
      </div>
      {item.atencao && item.atencao.length > 0 && (
        <div className="space-y-1 rounded-lg bg-amber-50 p-3 text-amber-950">
          <p className="text-xs font-semibold uppercase tracking-wide">Atenção</p>
          {item.atencao.length === 1 ? (
            <p>{item.atencao[0]}</p>
          ) : (
            <ul className="list-disc space-y-1 pl-5">
              {item.atencao.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Botão "?" de ajuda. Textos em src/content/ajuda.ts.
 * Discreto (ícone de 18 px) num botão de 44 × 44 px (área de toque); fecha com Esc.
 */
export function Ajuda({ id, className }: { id: AjudaId; className?: string }) {
  const desktop = useDesktop();
  const item = AJUDA[id];

  const botao = (
    <button
      type="button"
      className={cn(
        // 44 × 44 de toque no próprio botão (o ícone continua pequeno); -my-2 não aumenta a altura da linha
        "-my-2 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full align-middle text-muted-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className
      )}
      aria-label={`Ajuda: ${item.titulo}`}
      // dentro de rótulos e linhas clicáveis: só abre a ajuda
      onClick={(e) => e.stopPropagation()}
      data-testid={`btn-ajuda-${id}`}
    >
      <HelpCircle className="h-[18px] w-[18px]" aria-hidden />
    </button>
  );

  if (desktop) {
    return (
      <Popover>
        <PopoverTrigger asChild>{botao}</PopoverTrigger>
        <PopoverContent
          align="start"
          collisionPadding={16}
          className="max-h-[min(70svh,32rem)] w-80 overflow-y-auto"
          aria-label={`Ajuda: ${item.titulo}`}
          data-testid={`ajuda-${id}`}
        >
          <Corpo item={item} comTitulo />
        </PopoverContent>
      </Popover>
    );
  }

  return (
    <Sheet>
      <SheetTrigger asChild>{botao}</SheetTrigger>
      <SheetContent side="bottom" className="max-h-[85svh] overflow-y-auto rounded-t-2xl" data-testid={`ajuda-${id}`}>
        <SheetHeader className="pr-10 text-left">
          <SheetTitle className="font-heading text-xl">{item.titulo}</SheetTitle>
          <SheetDescription className="sr-only">Ajuda sobre {item.titulo}</SheetDescription>
        </SheetHeader>
        <div className="pt-3">
          <Corpo item={item} comTitulo={false} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
