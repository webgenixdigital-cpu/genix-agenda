"use client";

// Invólucro <li> do cartão da Agenda. Esconde o cartão na hora em que um cancelamento é
// confirmado (antes do servidor responder), pelo ID do agendamento, via estado do React.
// Antes isso era uma classe "hidden" posta direto no elemento: quando a lista era
// redesenhada, o React reaproveitava o elemento para o agendamento seguinte e a classe
// ficava, escondendo um agendamento que continuava ativo.
import { useBookingDialogs } from "@/components/admin/agenda/booking-dialogs";
import { cn } from "@/lib/utils";

export function AgendaCardShell({
  bookingId,
  className,
  children,
}: {
  bookingId: string;
  className?: string;
  children: React.ReactNode;
}) {
  const { hiddenIds } = useBookingDialogs();
  return (
    <li
      className={cn(className, hiddenIds.has(bookingId) && "hidden")}
      data-testid={`agenda-item-${bookingId}`}
      data-agenda-card
    >
      {children}
    </li>
  );
}
