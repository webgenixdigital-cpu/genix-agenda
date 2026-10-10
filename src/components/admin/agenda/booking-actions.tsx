"use client";

import { useEffect, useState, useTransition } from "react";
import { Check, CheckCheck, Loader2, MessageCircle, Star, X } from "lucide-react";
import { toast } from "sonner";
import { completeBooking, updateBookingStatus } from "@/app/admin/(painel)/agenda/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { brl, whatsappLink } from "@/lib/format";
import { customerMessage } from "@/lib/messages";
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
}: {
  booking: AgendaBooking;
  businessName: string;
  slug: string;
}) {
  const [pending, start] = useTransition();
  const [completeOpen, setCompleteOpen] = useState(false);
  const [origin, setOrigin] = useState("");

  useEffect(() => setOrigin(window.location.origin), []);

  const reviewUrl = origin ? `${origin}/v/${slug}/avaliar/${b.id}` : undefined;
  const wa = whatsappLink(b.customer_phone, customerMessage(b, businessName, reviewUrl));

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, success: string) {
    start(async () => {
      const r = await fn();
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
        <Button size="sm" className="h-10" disabled={pending} onClick={() => setCompleteOpen(true)} data-testid={`btn-concluir-${b.id}`}>
          <CheckCheck className="mr-1.5 h-4 w-4" /> Concluir
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
            if (confirm(`Cancelar o horário de ${b.customer_name}?`)) {
              run(() => updateBookingStatus(b.id, "cancelled"), "Agendamento cancelado");
            }
          }}
          data-testid={`btn-cancelar-${b.id}`}
        >
          <X className="mr-1.5 h-4 w-4" /> Cancelar
        </Button>
      )}

      {/* Concluir: escolher forma de pagamento */}
      <Dialog open={completeOpen} onOpenChange={setCompleteOpen}>
        <DialogContent className="max-w-sm rounded-2xl">
          <DialogHeader>
            <DialogTitle className="font-heading text-2xl">Concluir atendimento</DialogTitle>
            <DialogDescription>
              {b.service_name} de {b.customer_name}, {brl(b.price)}. Como foi o pagamento?
            </DialogDescription>
          </DialogHeader>
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
          <Button
            variant="ghost"
            className="h-11"
            disabled={pending}
            onClick={() => {
              setCompleteOpen(false);
              run(() => completeBooking(b.id, null), "Atendimento concluído");
            }}
          >
            Concluir sem lançar no caixa
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}