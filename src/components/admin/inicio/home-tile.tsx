import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** normal = cores da marca · alerta = âmbar discreto · calmo = nada a fazer ("Tudo em dia") */
export type HomeTileTone = "normal" | "alerta" | "calmo";

type Props = {
  id: string;
  href: string;
  icon: LucideIcon;
  title: string;
  value: string;
  hint: string;
  tone?: HomeTileTone;
  /** valor em texto (nome do plano, data) usa letra menor que um número */
  textValue?: boolean;
};

const TONE: Record<HomeTileTone, { box: string; chip: string; value: string; hint: string }> = {
  normal: {
    box: "border-border bg-card hover:border-primary/40 hover:bg-[#FFFDF9]",
    chip: "bg-primary/10 text-primary",
    value: "text-foreground",
    hint: "text-muted-foreground",
  },
  alerta: {
    box: "border-amber-300 bg-amber-50 hover:bg-amber-100/70",
    chip: "bg-amber-100 text-amber-700",
    value: "text-amber-950",
    hint: "text-amber-900",
  },
  calmo: {
    box: "border-border/70 bg-card/60 hover:bg-card",
    chip: "bg-muted text-muted-foreground",
    value: "text-muted-foreground",
    hint: "text-muted-foreground",
  },
};

/** Quadro clicável do Início: ícone + número grande + frase curta, leva à tela relacionada */
export function HomeTile({ id, href, icon: Icon, title, value, hint, tone = "normal", textValue }: Props) {
  const t = TONE[tone];
  return (
    <Link
      href={href}
      data-testid={`quadro-${id}`}
      className={cn(
        "flex min-h-[9.5rem] min-w-0 flex-col rounded-2xl border p-4 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:aspect-square sm:min-h-0 md:aspect-auto md:min-h-[140px] md:p-4",
        t.box
      )}
    >
      <span className="flex items-center gap-1.5 sm:gap-2">
        <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-lg sm:size-9 sm:rounded-xl", t.chip)} aria-hidden>
          <Icon className="size-4 sm:size-[18px]" />
        </span>
        <span className="min-w-0 break-words text-[13px] font-semibold leading-tight sm:text-sm">{title}</span>
      </span>
      <span className="mt-auto pt-3 md:pt-2">
        <span
          className={cn(
            "block break-words font-heading leading-tight",
            textValue ? "text-xl md:text-2xl" : "text-3xl",
            t.value
          )}
        >
          {value}
        </span>
        <span className={cn("mt-1 block text-xs leading-snug sm:text-sm", t.hint)}>{hint}</span>
      </span>
    </Link>
  );
}
