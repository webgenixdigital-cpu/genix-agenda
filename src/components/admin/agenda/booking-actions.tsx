"use client";

// Botões das ações de um agendamento (cartão da lista e detalhe da semana).
// Os DIÁLOGOS não moram aqui: ficam no BookingDialogsProvider (layout da Agenda), com uma
// cópia do agendamento, para não trocarem de agendamento nem fecharem sozinhos quando a
// lista é redesenhada depois de salvar (ver booking-dialogs.tsx).
import { useEffect, useState, useTransition } from "react";
import { CalendarClock, Check, CheckCheck, Loader2, MessageCircle, Pencil, Repeat, Star, X } from "lucide-react";
import { toast } from "sonner";
import { updateBookingStatus } from "@/app/admin/(painel)/agenda/actions";
import { Button } from "@/components/ui/button";
import { whatsappLink } from "@/lib/format";
import { customerMessage } from "@/lib/messages";
import type { ProOption } from "@/components/admin/agenda/reschedule-dialog";
import { ReopenBookingButton } from "@/components/admin/agenda/reopen-booking-button";
import { useBookingDialogs, type BookingDialogKind } from "@/components/admin/agenda/booking-dialogs";
import type { BookingStatus } from "@/lib/types";

export type AgendaBooking = {
  id: string;
  booking_date: string;
  start_time: string;
  end_time: string;
  customer_name: string;
  customer_phone: string;
  /** código do país (45); ausente = Brasil */
  customer_phone_country?: string | null;
  customer_notes: string | null;
  service_name: string;
  professional_name: string;
  price: number;
  status: BookingStatus;
  source: string;
  /** sessão de pacote: já foi paga na venda do pacote */
  customer_package_id?: string | null;
  /** faz parte de uma série recorrente */
  series_id?: string | null;
  /** motivo da confirmação automática (vitrine) */
  auto_confirm_reason?: string | null;
  professional_id: string;
  service_id: string | null;
  /** quantos serviços (original + adicionais); mais de 1 mostra o total nas mensagens */
  items_count?: number;
};

/** Dados para o botão "Remarcar" (opcional: sem ele, o botão não aparece) */
export type RescheduleProps = {
  professionals: ProOption[];
  /** matriz e recepção: trocam o profissional e podem encaixar */
  canChooseProfessional: boolean;
  /** "Reabrir atendimento" nos concluídos (matriz e recepção) */
  canReopen?: boolean;
  today: string;
};

export function BookingActions({
  booking: b,
  businessName,
  slug,
  fullAccess = true,
  reschedule,
  onCancelling,
}: {
  booking: AgendaBooking;
  businessName: string;
  slug: string;
  /** plano pago (Profissional ou Equipe): pergunta a forma de pagamento e lança no caixa */
  fullAccess?: boolean;
  reschedule?: RescheduleProps;
  /** cancelamento confirmado (true) ou desfeito por erro (false): quem lista esconde na hora */
  onCancelling?: (hidden: boolean) => void;
}) {
  const { openBooking } = useBookingDialogs();
  const [pending, start] = useTransition();
  const [origin, setOrigin] = useState("");

  useEffect(() => setOrigin(window.location.origin), []);

  const reviewUrl = origin ? `${origin}/v/${slug}/avaliar/${b.id}` : undefined;
  const wa = whatsappLink(b.customer_phone, customerMessage(b, businessName, reviewUrl), b.customer_phone_country);
  const open = (kind: BookingDialogKind) => openBooking(kind, b, { businessName, slug, fullAccess, reschedule, onCancelling });

  return (
    <div className="flex flex-wrap gap-2">
      {b.status === "pending" && (
        <Button
          size="sm"
          className="h-10"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await updateBookingStatus(b.id, "confirmed");
              if (!r) return; // demonstração: o servidor redirecionou
              if (r.ok) toast.success("Agendamento confirmado");
              else toast.error(r.error);
            })
          }
          data-testid={`btn-confirmar-${b.id}`}
        >
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="mr-1.5 h-4 w-4" />}
          Confirmar
        </Button>
      )}

      {b.status === "confirmed" && (
        <Button size="sm" className="h-10" disabled={pending} onClick={() => open("complete")} data-testid={`btn-concluir-${b.id}`}>
          <CheckCheck className="mr-1.5 h-4 w-4" /> Concluir
        </Button>
      )}

      {(b.status === "pending" || b.status === "confirmed") && (
        <Button size="sm" variant="outline" className="h-10" disabled={pending} onClick={() => open("edit")} data-testid={`btn-editar-${b.id}`}>
          <Pencil className="mr-1.5 h-4 w-4" /> Editar
        </Button>
      )}

      {reschedule && (b.status === "pending" || b.status === "confirmed") && (
        <Button
          size="sm"
          variant="outline"
          className="h-10"
          disabled={pending}
          onClick={() => open("reschedule")}
          data-testid={`btn-remarcar-${b.id}`}
        >
          <CalendarClock className="mr-1.5 h-4 w-4" /> Remarcar
        </Button>
      )}

      {wa && (
        <Button asChild size="sm" className="h-10 bg-whatsapp text-white hover:bg-whatsapp-hover">
          <a href={wa} target="_blank" rel="noopener noreferrer" data-testid={`btn-whatsapp-cliente-${b.id}`}>
            {b.status === "completed" ? <Star className="mr-1.5 h-4 w-4" /> : <MessageCircle className="mr-1.5 h-4 w-4" />}
            {b.status === "completed" ? "Pedir avaliação" : "WhatsApp"}
          </a>
        </Button>
      )}

      {b.status === "completed" && reschedule?.canReopen && (
        <ReopenBookingButton
          bookingId={b.id}
          customerName={b.customer_name}
          packageSession={!!b.customer_package_id}
          onOpen={() => open("reopen")}
        />
      )}

      {(b.status === "pending" || b.status === "confirmed") && (
        <Button
          size="sm"
          variant="ghost"
          className="h-10 text-destructive hover:bg-red-50 hover:text-destructive"
          disabled={pending}
          onClick={() => open("cancel")}
          data-testid={`btn-cancelar-${b.id}`}
        >
          <X className="mr-1.5 h-4 w-4" /> Cancelar
        </Button>
      )}

      {b.series_id && (b.status === "pending" || b.status === "confirmed") && (
        <Button
          size="sm"
          variant="ghost"
          className="h-10 text-muted-foreground hover:bg-red-50 hover:text-destructive"
          disabled={pending}
          onClick={() => open("cancel-series")}
          data-testid={`btn-cancelar-serie-${b.id}`}
        >
          <Repeat className="mr-1.5 h-4 w-4" /> Cancelar as próximas desta série
        </Button>
      )}
    </div>
  );
}
