// Cartão de um agendamento (lista do Dia e lista do dia no Mês) + aviso de bloqueio.
// Sem "use client": serve na página (servidor) e no calendário (cliente).
import Link from "next/link";
import { CalendarOff, Globe, Package, Phone, Repeat, StickyNote } from "lucide-react";
import { StatusBadge } from "@/components/admin/status-badge";
import { AutoConfirmBadge } from "@/components/admin/auto-confirm-badge";
import { BookingActions, type RescheduleProps } from "@/components/admin/agenda/booking-actions";
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
    <li
      className={cn(
        "rounded-2xl border bg-card p-4 md:p-5",
        b.status === "cancelled" && "opacity-60",
        b.status === "pending" && "border-amber-300"
      )}
      data-testid={`agenda-item-${b.id}`}
      data-agenda-card
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
                {b.customer_name}
              </Link>
            ) : (
              <p className="font-semibold">{b.customer_name}</p>
            )}
            <StatusBadge status={b.status} />
            <AutoConfirmBadge status={b.status} reason={b.auto_confirm_reason} testId={`selo-auto-confirmado-${b.id}`} />
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
        <BookingActions booking={b} businessName={businessName} slug={slug} fullAccess={fullAccess} reschedule={reschedule} />
      </div>
    </li>
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
