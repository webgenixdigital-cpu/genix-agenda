// Botão quadrado das ações do agendamento: ícone em cima, rótulo curto embaixo.
// Vários lado a lado numa fileira (ActionRow) dividem a largura por igual, sem quebrar linha.
// Sem "use client": só desenho; quem usa decide o onClick (client) ou o href.
import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cn } from "@/lib/utils";

export type ActionTileVariant = "primary" | "default" | "danger" | "whatsapp";

const VARIANT: Record<ActionTileVariant, string> = {
  // ação principal do status (Confirmar no pendente, Concluir no confirmado, Pagamento pendente)
  primary: "border-primary bg-primary text-primary-foreground hover:bg-primary/90",
  default: "border-border bg-card text-foreground hover:bg-secondary",
  // destrutiva, discreta: texto/ícone vermelhos, borda clara
  danger: "border-red-200 bg-card text-destructive hover:bg-red-50",
  // WhatsApp: ícone verde, fundo neutro
  whatsapp: "border-border bg-card text-foreground hover:bg-secondary [&_svg]:text-whatsapp",
};

type TileProps = {
  icon: React.ReactNode;
  label: string;
  variant?: ActionTileVariant;
  /** só o ícone abaixo de 640 px (quadrado de 44 px); o rótulo vira aria-label */
  iconOnlyOnMobile?: boolean;
  /** renderiza o filho (ex.: <a>) no lugar do <button> */
  asChild?: boolean;
  children?: React.ReactNode;
} & React.ButtonHTMLAttributes<HTMLButtonElement>;

export const ActionTile = React.forwardRef<HTMLButtonElement, TileProps>(function ActionTile(
  { icon, label, variant = "default", iconOnlyOnMobile = false, asChild = false, className, children, ...props },
  ref
) {
  const Comp = asChild ? Slot : "button";
  const content = (
    <>
      <span className="flex h-5 w-5 items-center justify-center [&_svg]:h-5 [&_svg]:w-5" aria-hidden>
        {icon}
      </span>
      <span className={cn("whitespace-nowrap text-[11px] font-medium leading-tight", iconOnlyOnMobile && "sr-only sm:not-sr-only")}>
        {label}
      </span>
    </>
  );
  return (
    <Comp
      ref={ref}
      type={asChild ? undefined : "button"}
      aria-label={iconOnlyOnMobile ? label : undefined}
      className={cn(
        "flex h-14 min-w-[44px] flex-col items-center justify-center gap-1 rounded-xl border px-0.5 transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
        iconOnlyOnMobile ? "w-11 flex-none sm:w-auto sm:flex-1 sm:basis-0" : "min-w-0 flex-1 basis-0",
        VARIANT[variant],
        className
      )}
      {...props}
    >
      {asChild ? React.cloneElement(children as React.ReactElement, {}, content) : content}
    </Comp>
  );
});

/** Fileira de ActionTile: uma linha só, larguras iguais */
export function ActionRow({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("flex w-full items-stretch gap-1.5", className)} {...props}>
      {children}
    </div>
  );
}
