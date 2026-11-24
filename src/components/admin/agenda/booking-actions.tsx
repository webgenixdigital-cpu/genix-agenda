"use client";

// Botões das ações de um agendamento (cartão da lista e detalhe da semana).
// Os DIÁLOGOS não moram aqui: ficam no BookingDialogsProvider (layout da Agenda), com uma
// cópia do agendamento, para não trocarem de agendamento nem fecharem sozinhos quando a
// lista é redesenhada depois de salvar (ver booking-dialogs.tsx).
import { useEffect, useState, useTransition } from "react";
import { CalendarClock, Check, CheckCheck, Loader2, MessageCircle, Pencil, Repeat, Star, Wallet, X } from "lucide-react";
import { toast } from "sonner";
import { updateBookingStatus } from "@/app/admin/(painel)/agenda/actions";
import { ActionRow, ActionTile } from "@/components/admin/agenda/action-tile";
import { whatsappLink } from "@/lib/format";
import { customerMessage } from "@/lib/messages";
import type { ProOption } from "@/components/admin/agenda/reschedule-dialog";
import { ReopenBookingButton } from "@/components/admin/agenda/reopen-booking-button";
import { useBookingDialogs, type BookingDialogKind } from "@/components/admin/agenda/booking-dialogs";
import { usePlanFlags } from "@/components/admin/plan-flags";
import { useNicheFlags } from "@/components/admin/niche-flags";
import { BookingTransportButton } from "@/components/admin/leva-e-traz/booking-transport-button";
import { attendeeText } from "@/lib/pets";
import type { BookingStatus } from "@/lib/types";
import { vitrineUrl } from "@/lib/vitrine-url";

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
  /** 49: 'pending' = concluído com "Escolher depois"; 'paid' = pago depois */
  payment_status?: "pending" | "paid" | null;
  /** 50: encaixe sobreposto (por cima de outro atendimento do mesmo profissional) */
  overlay?: boolean;
  /** 64: banho e tosa — nome do pet atendido (o tutor segue em customer_name) */
  pet_name?: string | null;
  /** 4a: leva e traz (só banho e tosa traz o campo) */
  transport?: "nenhum" | "busca" | "entrega" | "busca_entrega";
};

/** Dados para o botão "Remarcar" (opcional: sem ele, o botão não aparece) */
export type RescheduleProps = {
  professionals: ProOption[];
  /** matriz e recepção: trocam o profissional e podem encaixar */
  canChooseProfessional: boolean;
  /** 67: encaixe no Remarcar nos planos Profissional e Equipe (Grátis e Básico: cadeado) */
  canFit?: boolean;
  /** "Reabrir atendimento" nos concluídos (matriz e recepção) */
  canReopen?: boolean;
  /** 50: "Encaixe sobreposto" no Novo agendamento e no Remarcar (matriz e recepção em qualquer agenda; profissional na própria) */
  canOverlay?: boolean;
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
  // 59: Grátis vencido = só consulta (cancelar continua); pedido de avaliação só no Profissional+
  const { readOnly, reviewRequest } = usePlanFlags();
  const { petMode } = useNicheFlags();
  const [pending, start] = useTransition();
  const [origin, setOrigin] = useState("");

  useEffect(() => setOrigin(window.location.origin), []);

  const reviewUrl = origin && reviewRequest ? `${vitrineUrl(slug, origin)}/avaliar/${b.id}` : undefined;
  const wa = whatsappLink(b.customer_phone, customerMessage(b, businessName, reviewUrl), b.customer_phone_country);
  const open = (kind: BookingDialogKind) => openBooking(kind, b, { businessName, slug, fullAccess, reschedule, onCancelling });

  const active = b.status === "pending" || b.status === "confirmed";
  const editable = active && !readOnly;
  const askReview = b.status === "completed" && reviewRequest;

  return (
    <div className="space-y-2">
      <ActionRow data-testid={`acoes-${b.id}`}>
        {b.status === "pending" && !readOnly && (
          <ActionTile
            variant="primary"
            icon={pending ? <Loader2 className="animate-spin" /> : <Check />}
            label="Confirmar"
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
          />
        )}

        {b.status === "confirmed" && !readOnly && (
          <ActionTile
            variant="primary"
            icon={<CheckCheck />}
            label="Concluir"
            disabled={pending}
            onClick={() => open("complete")}
            data-testid={`btn-concluir-${b.id}`}
          />
        )}

        {editable && (
          <ActionTile icon={<Pencil />} label="Editar" disabled={pending} onClick={() => open("edit")} data-testid={`btn-editar-${b.id}`} />
        )}

        {reschedule && editable && (
          <ActionTile
            icon={<CalendarClock />}
            label="Remarcar"
            disabled={pending}
            onClick={() => open("reschedule")}
            data-testid={`btn-remarcar-${b.id}`}
          />
        )}

        {wa && (
          <ActionTile
            asChild
            variant="whatsapp"
            // pendente/confirmado: 5 botões; no celular o WhatsApp fica só no ícone (cabe em 360 px)
            iconOnlyOnMobile={active}
            icon={askReview ? <Star /> : <MessageCircle />}
            label={askReview ? "Avaliação" : "WhatsApp"}
          >
            <a href={wa} target="_blank" rel="noopener noreferrer" data-testid={`btn-whatsapp-cliente-${b.id}`} />
          </ActionTile>
        )}

        {b.status === "completed" && b.payment_status === "pending" && (
          <ActionTile
            variant="primary"
            icon={<Wallet />}
            label="Pagamento"
            onClick={() => open("payment")}
            data-testid={`btn-registrar-pagamento-${b.id}`}
          />
        )}

        {b.status === "completed" && reschedule?.canReopen && !readOnly && (
          <ReopenBookingButton
            variant="tile"
            bookingId={b.id}
            customerName={b.customer_name}
            packageSession={!!b.customer_package_id}
            onOpen={() => open("reopen")}
          />
        )}

        {active && (
          <ActionTile
            variant="danger"
            icon={<X />}
            label="Cancelar"
            disabled={pending}
            onClick={() => open("cancel")}
            data-testid={`btn-cancelar-${b.id}`}
          />
        )}
      </ActionRow>

      {/* 4b: leva e traz do pet (banho e tosa; matriz e recepção) */}
      {petMode && editable && reschedule?.canChooseProfessional && (
        <BookingTransportButton bookingId={b.id} current={b.transport} who={attendeeText(b)} />
      )}

      {/* linha própria, só quando existir */}
      {b.series_id && active && (
        <button
          type="button"
          className="flex min-h-11 w-full items-center justify-center gap-1.5 rounded-lg text-sm text-destructive/80 hover:bg-red-50 hover:text-destructive disabled:opacity-50"
          disabled={pending}
          onClick={() => open("cancel-series")}
          data-testid={`btn-cancelar-serie-${b.id}`}
        >
          <Repeat className="h-4 w-4" /> Cancelar as próximas desta série
        </button>
      )}
    </div>
  );
}
