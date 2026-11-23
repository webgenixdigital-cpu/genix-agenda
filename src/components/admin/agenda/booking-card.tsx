// Cartão de um agendamento (lista do Dia e lista do dia no Mês) + aviso de bloqueio.
// Sem "use client": serve na página (servidor) e no calendário (cliente).
import Link from "next/link";
import { CalendarOff, Car, Globe, Layers2, Package, PawPrint, Phone, Repeat, StickyNote } from "lucide-react";
import { TRANSPORT_LABEL, attendeeName, tutorLine } from "@/lib/pets";
import { StatusBadge } from "@/components/admin/status-badge";
import { AutoConfirmBadge } from "@/components/admin/auto-confirm-badge";
import { PaymentPendingBadge } from "@/components/admin/payment-pending-badge";
import { BookingActions, type RescheduleProps } from "@/components/admin/agenda/booking-actions";
import { AgendaCardShell } from "@/components/admin/agenda/agenda-card-shell";
import { brl } from "@/lib/format";
import { formatPhone } from "@/lib/phone";
import type { AgendaBlock, AgendaItem } from "@/lib/agenda";
import { cn } from "@/lib/utils";

const SOURCE: Record<string, string> = { online: "Vitrine", whatsapp: "WhatsApp", manual: "Manual" };

export function BookingCard({
  booking: b,
  sessionLabel,
  businessName,
  slug,
  fullAccess,
  reschedule,
}: {
  booking: AgendaItem;
  sessionLabel?: string;
  businessName: string;
  slug: string;
  fullAccess: boolean;
  reschedule: RescheduleProps;
}) {
  return (
    // key pelo id: no servidor (lista do Dia) a key do BookingCard não chega ao navegador
    <AgendaCardShell
      key={b.id}
      bookingId={b.id}
      className={cn(
        "rounded-2xl border bg-card p-4 md:p-5",
        b.status === "cancelled" && "opacity-60",
        b.status === "pending" && "border-amber-300",
        b.overlay && "border-2 border-dashed border-primary/50"
      )}
    >
      <div className="flex gap-4">
        <div className="w-[4.5rem] shrink-0 border-r pr-3 text-center">
          <p className="text-lg font-semibold">{b.start_time.slice(0, 5)}</p>
          <p className="text-xs text-muted-foreground">até {b.end_time.slice(0, 5)}</p>
        </div>

        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            {b.customer_id ? (
              <Link href={`/admin/clientes/${b.customer_id}`} className="tap-target font-semibold hover:underline" data-testid={`link-cliente-${b.id}`}>
                {b.pet_name && <PawPrint className="mr-1 inline h-4 w-4 text-primary" aria-hidden />}
                {attendeeName(b)}
              </Link>
            ) : (
              <p className="font-semibold">{attendeeName(b)}</p>
            )}
            {b.transport && b.transport !== "nenhum" && (
              <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-xs font-medium" data-testid={`selo-leva-traz-${b.id}`}>
                <Car className="h-3 w-3" aria-hidden /> {TRANSPORT_LABEL[b.transport]}
              </span>
            )}
            {tutorLine(b) && <span className="w-full text-xs text-muted-foreground" data-testid={`tutor-${b.id}`}>{tutorLine(b)}</span>}
            <StatusBadge status={b.status} />
            <AutoConfirmBadge status={b.status} reason={b.auto_confirm_reason} testId={`selo-auto-confirmado-${b.id}`} />
            {b.status === "completed" && b.payment_status === "pending" && <PaymentPendingBadge testId={`selo-pagamento-pendente-${b.id}`} />}
            {b.overlay && (
              <span
                className="inline-flex items-center gap-1 rounded-full border border-dashed border-primary/60 bg-secondary px-2 py-0.5 text-xs font-medium text-primary"
                title="Encaixe sobreposto: por cima de outro atendimento"
                data-testid={`selo-encaixe-${b.id}`}
              >
                <Layers2 className="h-3 w-3" /> Encaixe
              </span>
            )}
            {b.series_id && (
              <span
                className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-primary"
                data-testid={`selo-recorrente-${b.id}`}
              >
                <Repeat className="h-3 w-3" /> Recorrente
              </span>
            )}
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <Globe className="h-3 w-3" /> {SOURCE[b.source] ?? b.source}
            </span>
          </div>
          <p className="text-sm">
            {b.service_name} com {b.professional_name}
            {b.customer_package_id ? (
              <span
                className="ml-2 inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-primary"
                data-testid={`selo-pacote-${b.id}`}
              >
                <Package className="h-3 w-3" /> {sessionLabel ?? "Pacote"}
              </span>
            ) : (
              <span className="text-muted-foreground"> · {brl(b.price)}</span>
            )}
          </p>
          <p className="inline-flex items-center gap-1 text-sm text-muted-foreground">
            <Phone className="h-3.5 w-3.5" /> {formatPhone(b.customer_phone, b.customer_phone_country)}
          </p>
          {b.customer_notes && (
            <p className="flex items-start gap-1 rounded-lg bg-secondary px-2.5 py-1.5 text-sm">
              <StickyNote className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" /> {b.customer_notes}
            </p>
          )}
        </div>
      </div>

      <div className="mt-4 border-t pt-3">
        {/* key pelo id: no servidor (lista do Dia) a key do cartão não chega aqui, e sem ela o estado ficava preso à posição na lista */}
        <BookingActions key={b.id} booking={b} businessName={businessName} slug={slug} fullAccess={fullAccess} reschedule={reschedule} />
      </div>
    </AgendaCardShell>
  );
}

/** Aviso vermelho com os bloqueios do dia */
export function BlockNotice({ blocks, professionals }: { blocks: AgendaBlock[]; professionals: { id: string; name: string }[] }) {
  if (blocks.length === 0) return null;
  return (
    <div className="space-y-1 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-900" data-testid="aviso-bloqueio">
      {blocks.map((k, i) => (
        <p key={i} className="flex items-start gap-2">
          <CalendarOff className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            <strong>{k.reason ?? "Bloqueio"}</strong>
            {" para "}
            {k.professional_id ? professionals.find((p) => p.id === k.professional_id)?.name ?? "um profissional" : "toda a equipe"}
            {k.time_start ? `, das ${k.time_start.slice(0, 5)} às ${k.time_end?.slice(0, 5)}` : ", o dia inteiro"}
          </span>
        </p>
      ))}
    </div>
  );
}
