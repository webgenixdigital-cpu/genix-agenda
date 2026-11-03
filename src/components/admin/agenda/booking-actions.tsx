"use client";

import { useEffect, useState, useTransition } from "react";
import { CalendarClock, Check, CheckCheck, Loader2, MessageCircle, Pencil, Plus, Repeat, Star, X } from "lucide-react";
import { toast } from "sonner";
import { cancelSeriesFuture, completeBooking, updateBookingStatus } from "@/app/admin/(painel)/agenda/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { brl, whatsappLink } from "@/lib/format";
import { customerMessage } from "@/lib/messages";
import { RescheduleDialog, type ProOption } from "@/components/admin/agenda/reschedule-dialog";
import { EditBookingDialog, bookingTotals, useBookingEditInfo } from "@/components/admin/agenda/edit-booking-dialog";
import type { BookingStatus } from "@/lib/types";

export type AgendaBooking = {
  id: string;
  booking_date: string;
  start_time: string;
  end_time: string;
  customer_name: string;
  customer_phone: string;
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
  today: string;
};

const METHODS = [
  { value: "pix", label: "Pix" },
  { value: "dinheiro", label: "Dinheiro" },
  { value: "credito", label: "Cartão de crédito" },
  { value: "debito", label: "Cartão de débito" },
] as const;

export function BookingActions({
  booking: b,
  businessName,
  slug,
  fullAccess = true,
  reschedule,
}: {
  booking: AgendaBooking;
  businessName: string;
  slug: string;
  /** plano pago (Profissional ou Equipe): pergunta a forma de pagamento e lança no caixa */
  fullAccess?: boolean;
  reschedule?: RescheduleProps;
}) {
  const [pending, start] = useTransition();
  const [completeOpen, setCompleteOpen] = useState(false);
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  // "Adicionar serviço ou desconto" dentro do Concluir: ao fechar a edição, volta ao Concluir
  const [editFromComplete, setEditFromComplete] = useState(false);
  const summary = useBookingEditInfo(b.id, completeOpen);
  const totals = summary.info ? bookingTotals(summary.info) : null;
  // forma de pagamento só no plano pago e com valor a cobrar (sessão de pacote sem adicional: não)
  const askMethod = fullAccess && (totals?.charge ?? 0) > 0;
  const [origin, setOrigin] = useState("");

  useEffect(() => setOrigin(window.location.origin), []);

  const reviewUrl = origin ? `${origin}/v/${slug}/avaliar/${b.id}` : undefined;
  const wa = whatsappLink(b.customer_phone, customerMessage(b, businessName, reviewUrl));

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, success: string) {
    start(async () => {
      const r = await fn();
      if (!r) return; // demonstração: o servidor redirecionou
      if (r.ok) toast.success(success);
      else toast.error(r.error);
    });
  }

  return (
    <div className="flex flex-wrap gap-2">
      {b.status === "pending" && (
        <Button
          size="sm"
          className="h-10"
          disabled={pending}
          onClick={() => run(() => updateBookingStatus(b.id, "confirmed"), "Agendamento confirmado")}
          data-testid={`btn-confirmar-${b.id}`}
        >
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="mr-1.5 h-4 w-4" />}
          Confirmar
        </Button>
      )}

      {b.status === "confirmed" && (
        <Button
          size="sm"
          className="h-10"
          disabled={pending}
          onClick={() => setCompleteOpen(true)}
          data-testid={`btn-concluir-${b.id}`}
        >
          <CheckCheck className="mr-1.5 h-4 w-4" /> Concluir
        </Button>
      )}

      {(b.status === "pending" || b.status === "confirmed") && (
        <Button
          size="sm"
          variant="outline"
          className="h-10"
          disabled={pending}
          onClick={() => {
            setEditFromComplete(false);
            setEditOpen(true);
          }}
          data-testid={`btn-editar-${b.id}`}
        >
          <Pencil className="mr-1.5 h-4 w-4" /> Editar
        </Button>
      )}

      {reschedule && (b.status === "pending" || b.status === "confirmed") && (
        <Button
          size="sm"
          variant="outline"
          className="h-10"
          disabled={pending}
          onClick={() => setRescheduleOpen(true)}
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

      {(b.status === "pending" || b.status === "confirmed") && (
        <Button
          size="sm"
          variant="ghost"
          className="h-10 text-destructive hover:bg-red-50 hover:text-destructive"
          disabled={pending}
          onClick={() => {
            const note = b.customer_package_id ? "\n\nA sessão volta para o saldo do pacote." : "";
            if (confirm(`Cancelar o horário de ${b.customer_name}?${note}`)) {
              run(() => updateBookingStatus(b.id, "cancelled"), "Agendamento cancelado");
            }
          }}
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
          onClick={() => {
            const note = b.customer_package_id ? "\n\nAs sessões voltam para o saldo do pacote." : "";
            if (!confirm(`Cancelar este e os próximos horários desta série de ${b.customer_name}?\nOs que já passaram não mudam.${note}`)) return;
            start(async () => {
              const r = await cancelSeriesFuture(b.series_id!);
              if (!r) return; // demonstração: o servidor redirecionou
              if (!r.ok) return void toast.error(r.error);
              toast.success(
                r.cancelled === 0
                  ? "Nenhum horário futuro desta série para cancelar"
                  : `${r.cancelled} ${r.cancelled === 1 ? "horário cancelado" : "horários cancelados"}`
              );
            });
          }}
          data-testid={`btn-cancelar-serie-${b.id}`}
        >
          <Repeat className="mr-1.5 h-4 w-4" /> Cancelar as próximas desta série
        </Button>
      )}

      {reschedule && (
        <RescheduleDialog
          open={rescheduleOpen}
          onOpenChange={setRescheduleOpen}
          booking={b}
          businessName={businessName}
          professionals={reschedule.professionals}
          canChooseProfessional={reschedule.canChooseProfessional}
          today={reschedule.today}
        />
      )}

      <EditBookingDialog
        open={editOpen}
        onOpenChange={(o) => {
          setEditOpen(o);
          if (!o && editFromComplete) setCompleteOpen(true);
        }}
        bookingId={b.id}
        customerName={b.customer_name}
      />

      {/* Concluir: resumo, vender na hora e forma de pagamento */}
      <Dialog open={completeOpen} onOpenChange={setCompleteOpen}>
        <DialogContent className="max-h-[92svh] max-w-sm overflow-y-auto rounded-2xl">
          <DialogHeader>
            <DialogTitle className="font-heading text-2xl">Concluir atendimento</DialogTitle>
            <DialogDescription>
              {b.customer_name}
              {askMethod ? ". Como foi o pagamento?" : ""}
            </DialogDescription>
          </DialogHeader>

          {summary.error && <p className="rounded-xl bg-red-50 p-3 text-sm text-destructive">{summary.error}</p>}
          {!summary.info && !summary.error && (
            <p className="flex items-center justify-center gap-2 py-4 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
            </p>
          )}
          {summary.info && totals && (
            <div className="space-y-2 rounded-xl border p-3 text-sm" data-testid="resumo-concluir">
              <ul className="space-y-1">
                {summary.info.items.map((i) => (
                  <li key={i.id} className="flex justify-between gap-2">
                    <span className="min-w-0 truncate">{i.name}</span>
                    <span className="shrink-0 text-muted-foreground">{i.paid_by_package ? "pacote" : brl(i.price)}</span>
                  </li>
                ))}
                {totals.discount > 0 && (
                  <li className="flex justify-between gap-2 text-muted-foreground">
                    <span>Desconto</span>
                    <span>− {brl(totals.discount)}</span>
                  </li>
                )}
              </ul>
              <p className="flex justify-between border-t pt-2 text-base font-semibold">
                <span>{totals.byPackage > 0 ? "A cobrar" : "Total"}</span>
                <span>{brl(totals.charge)}</span>
              </p>
            </div>
          )}

          <Button
            variant="outline"
            className="h-11"
            disabled={pending || !summary.info}
            onClick={() => {
              setCompleteOpen(false);
              setEditFromComplete(true);
              setEditOpen(true);
            }}
            data-testid={`btn-concluir-editar-${b.id}`}
          >
            <Plus className="mr-1.5 h-4 w-4" /> Adicionar serviço ou desconto
          </Button>

          {!askMethod && (
            <Button
              className="h-12"
              disabled={pending || !summary.info}
              onClick={() => {
                setCompleteOpen(false);
                run(
                  () => completeBooking(b.id, null),
                  b.customer_package_id && !totals?.charge ? "Sessão do pacote concluída" : "Atendimento concluído"
                );
              }}
              data-testid={`btn-concluir-confirmar-${b.id}`}
            >
              <CheckCheck className="mr-1.5 h-4 w-4" /> Concluir
            </Button>
          )}

          {askMethod && (
            <div className="grid grid-cols-2 gap-2">
              {METHODS.map((m) => (
                <Button
                  key={m.value}
                  variant="outline"
                  className="h-12"
                  disabled={pending}
                  onClick={() => {
                    setCompleteOpen(false);
                    run(() => completeBooking(b.id, m.value), `Concluído e lançado no caixa (${m.label})`);
                  }}
                  data-testid={`pagamento-${m.value}`}
                >
                  {m.label}
                </Button>
              ))}
            </div>
          )}
          {askMethod && (
            <Button
              variant="ghost"
              className="h-11"
              disabled={pending}
              onClick={() => {
                setCompleteOpen(false);
                run(() => completeBooking(b.id, null), "Atendimento concluído");
              }}
              data-testid={`btn-concluir-sem-caixa-${b.id}`}
            >
              Concluir sem lançar no caixa
            </Button>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
