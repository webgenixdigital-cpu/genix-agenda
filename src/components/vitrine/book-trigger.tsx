"use client";

// Botão que pede a abertura do agendamento.
// O BookingWizard (próximo passo) escuta o evento "genix:book".
import { Button, type ButtonProps } from "@/components/ui/button";

export const BOOK_EVENT = "genix:book";

export function BookTrigger({
  serviceId,
  children,
  ...props
}: ButtonProps & { serviceId?: string }) {
  return (
    <Button
      {...props}
      onClick={() => window.dispatchEvent(new CustomEvent(BOOK_EVENT, { detail: { serviceId } }))}
    >
      {children}
    </Button>
  );
}