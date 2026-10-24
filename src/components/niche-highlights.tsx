// Destaques circulares dos nichos (estilo "destaques do Instagram")
import Link from "next/link";
import { NicheIcon } from "@/components/niche-icon";
import type { Niche } from "@/lib/niches";
import { cn } from "@/lib/utils";

export function NicheHighlights({
  niches,
  activeId,
  className,
}: {
  niches: Niche[];
  activeId?: string;
  className?: string;
}) {
  return (
    <nav aria-label="Tipos de atendimento" className={cn("-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0", className)}>
      <ul className="flex gap-4 pb-2 md:flex-wrap md:gap-5">
        {niches.map((n) => {
          const active = n.id === activeId;
          return (
            <li key={n.id} className="shrink-0">
              <Link
                href={`/explorar/${n.id}`}
                aria-current={active ? "page" : undefined}
                className="group flex w-[76px] flex-col items-center gap-2 text-center"
                data-testid={`destaque-${n.id}`}
              >
                {/* anel em degradê, como os destaques do Instagram */}
                <span
                  className={cn(
                    "rounded-full p-[3px] transition-transform duration-200 group-hover:scale-105 group-active:scale-95",
                    active
                      ? "bg-[conic-gradient(from_200deg,#99582A,#F2C078,#C47B47,#99582A)]"
                      : "bg-[conic-gradient(from_200deg,#C47B47,#F2C078,#E7E0D2,#C47B47)]"
                  )}
                >
                  <span className="block rounded-full bg-background p-[3px]">
                    <span
                      className={cn(
                        "grid h-[62px] w-[62px] place-items-center rounded-full",
                        active ? "bg-primary text-primary-foreground" : "bg-secondary text-primary"
                      )}
                    >
                      <NicheIcon name={n.icon} className="h-7 w-7" />
                    </span>
                  </span>
                </span>
                <span className={cn("line-clamp-2 text-xs leading-tight", active ? "font-semibold text-foreground" : "text-muted-foreground")}>
                  {n.name}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
