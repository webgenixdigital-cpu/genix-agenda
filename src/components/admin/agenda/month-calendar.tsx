"use client";

import { useMemo, useState, useTransition } from "react";
import { CalendarPlus, ChevronLeft, ChevronRight, Layers, Package, Repeat, X } from "lucide-react";
import { BlockNotice, BookingCard } from "@/components/admin/agenda/booking-card";
import { NewBookingDialog } from "@/components/admin/agenda/new-booking-dialog";
import { CancelledToggle, ProfessionalFilter, useAgendaNav } from "@/components/admin/agenda/agenda-toolbar";
import type { RescheduleProps } from "@/components/admin/agenda/booking-actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { addDaysISO } from "@/lib/dates";
import { longDate } from "@/lib/format";
import {
  addMonths,
  blockAppliesOn,
  monthRange,
  monthTitle,
  type AgendaBlock,
  type AgendaItem,
} from "@/lib/agenda";
import { STATUS_DOT, STATUS_STYLE } from "@/components/admin/agenda/status-colors";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------
// PARTE 1 — Tipos e utilidades
// ---------------------------------------------------------------------
type Props = {
  month: string; // yyyy-mm
  today: string;
  bookings: AgendaItem[];
  sessionLabel: Record<string, string>;
  blocks: AgendaBlock[];
  services: { id: string; name: string; price: number; duration_min: number; kind?: string | null }[];
  professionals: { id: string; name: string }[];
  /** profissional filtrado (staff: sempre o próprio) */
  selectedProfessional: string | null;
  fullAccess: boolean;
  businessName: string;
  slug: string;
  reschedule: RescheduleProps;
};

type Day = { date: string; inMonth: boolean; items: AgendaItem[]; blocks: AgendaBlock[]; active: number };

const WEEKDAYS = ["seg", "ter", "qua", "qui", "sex", "sáb", "dom"];
const STATUS_ORDER = ["pending", "confirmed", "completed", "cancelled"];
const MAX_ITEMS = 3;

/** Dias da grade com os agendamentos e bloqueios de cada um (1 passada nos agendamentos) */
function useMonthDays(p: Pick<Props, "month" | "bookings" | "blocks" | "selectedProfessional">) {
  const { month, bookings, blocks, selectedProfessional } = p;
  return useMemo(() => {
    const byDate = new Map<string, AgendaItem[]>();
    for (const b of bookings) {
      const list = byDate.get(b.booking_date);
      if (list) list.push(b);
      else byDate.set(b.booking_date, [b]);
    }
    const proBlocks = blocks.filter(
      (k) => !selectedProfessional || !k.professional_id || k.professional_id === selectedProfessional
    );
    const { from, to } = monthRange(month);
    const days: Day[] = [];
    for (let d = from; d <= to; d = addDaysISO(d, 1)) {
      const items = byDate.get(d) ?? [];
      days.push({
        date: d,
        inMonth: d.startsWith(month),
        items,
        blocks: proBlocks.filter((k) => blockAppliesOn(k, d)),
        active: items.filter((b) => b.status !== "cancelled").length,
      });
    }
    return days;
  }, [month, bookings, blocks, selectedProfessional]);
}

function dayLabel(d: Day, today: string) {
  const n = d.items.length;
  const count = n === 0 ? "nenhum agendamento" : `${n} ${n === 1 ? "agendamento" : "agendamentos"}`;
  return `${longDate(d.date)}${d.date === today ? " (hoje)" : ""}: ${count}${d.blocks.length ? ", com bloqueio" : ""}`;
}

const dayNumber = (iso: string) => Number(iso.slice(8, 10));
const wholeDayBlock = (d: Day) => d.blocks.some((k) => !k.time_start);

// ---------------------------------------------------------------------
// PARTE 2 — Lista do dia (painel lateral e janela do celular)
// ---------------------------------------------------------------------
function DayList(props: Props & { day: Day; onNew: () => void }) {
  const { day } = props;
  return (
    <div className="space-y-4">
      <Button className="h-11 w-full gap-2" onClick={props.onNew} data-testid="btn-novo-agendamento-dia">
        <CalendarPlus className="h-4 w-4" /> Novo agendamento
      </Button>
      <BlockNotice blocks={day.blocks} professionals={props.professionals} />
      {day.items.length === 0 ? (
        <div className="rounded-2xl border border-dashed bg-white p-8 text-center">
          <p className="font-heading text-xl">Dia livre</p>
          <p className="mt-1 text-sm text-muted-foreground">Nenhum atendimento com esses filtros.</p>
        </div>
      ) : (
        <ul className="space-y-3" data-testid="lista-dia-mes">
          {day.items.map((b) => (
            <BookingCard
              key={b.id}
              booking={b}
              sessionLabel={props.sessionLabel[b.id]}
              businessName={props.businessName}
              slug={props.slug}
              fullAccess={props.fullAccess}
              reschedule={props.reschedule}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function useNewBooking(props: Props) {
  const [slot, setSlot] = useState<{ date: string; time: string; professionalId: string | null } | null>(null);
  const defaultPro = props.selectedProfessional ?? (props.professionals.length === 1 ? props.professionals[0].id : null);
  const dialog = (
    <NewBookingDialog
      defaultDate={slot?.date ?? props.today}
      services={props.services}
      professionals={props.professionals}
      fullAccess={props.fullAccess}
      open={!!slot}
      onOpenChange={(o) => !o && setSlot(null)}
      initial={slot ?? undefined}
    />
  );
  return { open: (date: string) => setSlot({ date, time: "", professionalId: defaultPro }), dialog };
}

// ---------------------------------------------------------------------
// PARTE 3 — Desktop (md+): grade do mês + painel lateral do dia
// ---------------------------------------------------------------------
export function MonthCalendar(props: Props) {
  const days = useMonthDays(props);
  const [openDate, setOpenDate] = useState<string | null>(null);
  const open = days.find((d) => d.date === openDate) ?? null;
  const newBooking = useNewBooking(props);
  const comboIds = useMemo(
    () => new Set(props.services.filter((s) => s.kind === "combo").map((s) => s.id)),
    [props.services]
  );

  return (
    <>
      <div className="overflow-hidden rounded-2xl border bg-card" data-testid="grade-mes">
        <div className="grid grid-cols-7 border-b">
          {WEEKDAYS.map((w) => (
            <p key={w} className="py-2 text-center text-xs font-semibold uppercase text-muted-foreground">{w}</p>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {days.map((d, i) => {
            const extra = d.items.length - MAX_ITEMS;
            return (
              <button
                key={d.date}
                type="button"
                onClick={() => setOpenDate(d.date)}
                aria-label={dayLabel(d, props.today)}
                className={cn(
                  "relative flex min-h-32 flex-col gap-1 border-b p-1.5 text-left transition-colors hover:bg-primary/5 focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary",
                  i % 7 !== 0 && "border-l",
                  d.date === props.today && "bg-secondary",
                  wholeDayBlock(d) && "bg-stone-100",
                  !d.inMonth && "opacity-45"
                )}
                data-testid={`dia-mes-${d.date}`}
              >
                {d.blocks.length > 0 && (
                  <span
                    className="absolute inset-x-0 top-0 h-1.5"
                    style={{ backgroundImage: "repeating-linear-gradient(45deg, rgba(120,113,108,.45) 0 4px, rgba(120,113,108,.18) 4px 8px)" }}
                    data-testid={`faixa-bloqueio-mes-${d.date}`}
                  />
                )}
                <span className="flex items-center justify-between gap-1">
                  <span
                    className={cn(
                      "flex h-7 w-7 items-center justify-center rounded-full text-sm font-semibold",
                      d.date === props.today && "bg-primary text-primary-foreground"
                    )}
                  >
                    {dayNumber(d.date)}
                  </span>
                  {d.blocks.length > 0 && <span className="truncate text-[11px] text-stone-600">Bloqueio</span>}
                </span>
                {d.items.slice(0, MAX_ITEMS).map((b) => (
                  <span
                    key={b.id}
                    className={cn("flex items-center gap-1 truncate rounded border px-1 py-0.5 text-[11px] leading-tight", STATUS_STYLE[b.status])}
                    data-testid={`item-mes-${b.id}`}
                  >
                    <span className="font-semibold">{b.start_time.slice(0, 5)}</span>
                    <span className="truncate">{b.customer_name}</span>
                    <span className="ml-auto flex shrink-0 gap-0.5 text-primary">
                      {b.service_id && comboIds.has(b.service_id) && <Layers className="h-3 w-3" aria-label="Combo" />}
                      {b.customer_package_id && <Package className="h-3 w-3" aria-label="Pacote" />}
                      {b.series_id && <Repeat className="h-3 w-3" aria-label="Recorrente" />}
                    </span>
                  </span>
                ))}
                {extra > 0 && (
                  <span className="px-1 text-[11px] font-semibold text-primary" data-testid={`mais-dia-${d.date}`}>
                    +{extra} mais
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <Sheet open={!!open} onOpenChange={(o) => !o && setOpenDate(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl" data-testid="painel-dia">
          {open && (
            <>
              <SheetHeader className="mb-4 text-left">
                <SheetTitle className="font-heading text-2xl first-letter:uppercase">{longDate(open.date)}</SheetTitle>
                <SheetDescription>
                  {open.active} {open.active === 1 ? "atendimento" : "atendimentos"}
                </SheetDescription>
              </SheetHeader>
              <DayList {...props} day={open} onNew={() => newBooking.open(open.date)} />
            </>
          )}
        </SheetContent>
      </Sheet>

      {newBooking.dialog}
    </>
  );
}

// ---------------------------------------------------------------------
// PARTE 4 — Celular (< md): janela tela cheia com o mês e a lista do dia
// ---------------------------------------------------------------------
export function MobileCalendar(props: Props & { currentDate: string; showCancelled: boolean; professionalId: string }) {
  const days = useMonthDays(props);
  const go = useAgendaNav();
  const [navigating, startNav] = useTransition();
  const [openDate, setOpenDate] = useState<string | null>(null);
  const [picked, setPicked] = useState(props.currentDate);
  const open = days.find((d) => d.date === openDate) ?? null;
  const newBooking = useNewBooking(props);
  const thisMonth = props.month === props.today.slice(0, 7);

  const nav = (patch: Record<string, string | null>) => {
    setOpenDate(null);
    startNav(() => go(patch, true));
  };
  // fechar: volta para a Agenda Dia no dia escolhido
  const close = () => go({ calendario: null, cancelados: null, data: picked === props.today ? null : picked }, true);

  return (
    <Dialog open onOpenChange={(o) => !o && close()}>
      <DialogContent
        className="left-0 top-0 flex h-[100svh] max-h-[100svh] w-full max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-y-auto overflow-x-hidden rounded-none border-0 p-0 data-[state=closed]:!slide-out-to-left-0 data-[state=closed]:!slide-out-to-top-0 data-[state=open]:!slide-in-from-left-0 data-[state=open]:!slide-in-from-top-0 sm:rounded-none [&>button:last-child]:hidden"
        data-testid="janela-calendario"
      >
        {/* topo fixo */}
        <div className="sticky top-0 z-10 space-y-2 border-b bg-background px-4 pb-3 pt-3">
          <div className="flex items-center gap-2">
            {open ? (
              <Button variant="ghost" className="h-11 gap-1 px-2" onClick={() => setOpenDate(null)} data-testid="btn-voltar-mes">
                <ChevronLeft className="h-5 w-5" /> Voltar ao mês
              </Button>
            ) : (
              <DialogTitle className="flex-1 font-heading text-2xl first-letter:uppercase">{monthTitle(props.month)}</DialogTitle>
            )}
            <Button variant="ghost" size="icon" className="ml-auto h-11 w-11" onClick={close} aria-label="Fechar calendário" data-testid="btn-fechar-calendario">
              <X className="h-5 w-5" />
            </Button>
          </div>
          <DialogDescription className="sr-only">Calendário do mês da agenda</DialogDescription>

          {!open && (
            <>
              <div className="flex items-center gap-1">
                <Button variant="outline" size="icon" className="h-11 w-11" onClick={() => nav({ calendario: addMonths(props.month, -1) })} aria-label="Mês anterior" data-testid="btn-mes-anterior">
                  <ChevronLeft className="h-5 w-5" />
                </Button>
                <Button variant="outline" size="icon" className="h-11 w-11" onClick={() => nav({ calendario: addMonths(props.month, 1) })} aria-label="Próximo mês" data-testid="btn-mes-proximo">
                  <ChevronRight className="h-5 w-5" />
                </Button>
                <Button variant="ghost" className="h-11" disabled={thisMonth} onClick={() => nav({ calendario: props.today.slice(0, 7) })} data-testid="btn-mes-hoje">
                  Hoje
                </Button>
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <ProfessionalFilter
                  value={props.professionalId}
                  professionals={props.professionals}
                  onChange={(v) => nav({ prof: v })}
                  className="w-full"
                />
                <CancelledToggle checked={props.showCancelled} onChange={(v) => nav({ cancelados: v ? "1" : null })} />
              </div>
            </>
          )}
        </div>

        <div className="flex-1 px-4 py-4">
          {open ? (
            <div className="space-y-3">
              <div>
                <p className="font-heading text-2xl first-letter:uppercase">{longDate(open.date)}</p>
                <p className="text-sm text-muted-foreground">
                  {open.active} {open.active === 1 ? "atendimento" : "atendimentos"}
                </p>
              </div>
              <DayList {...props} day={open} onNew={() => newBooking.open(open.date)} />
            </div>
          ) : navigating ? (
            <MonthSkeleton compact />
          ) : (
            <div data-testid="grade-mes-celular">
              <div className="grid grid-cols-7">
                {WEEKDAYS.map((w) => (
                  <p key={w} className="py-1 text-center text-[11px] font-semibold uppercase text-muted-foreground">{w}</p>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-0.5">
                {days.map((d) => {
                  const statuses = STATUS_ORDER.filter((s) => d.items.some((b) => b.status === s)).slice(0, 3);
                  return (
                    <button
                      key={d.date}
                      type="button"
                      onClick={() => {
                        setPicked(d.date);
                        setOpenDate(d.date);
                      }}
                      aria-label={dayLabel(d, props.today)}
                      className={cn(
                        "relative flex min-h-14 min-w-0 flex-col items-center justify-start gap-0.5 overflow-hidden rounded-lg border pb-1 pt-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                        d.date === props.today ? "border-primary bg-secondary" : "border-transparent",
                        d.date === picked && d.date !== props.today && "border-primary/40",
                        d.blocks.length > 0 && "bg-stone-200/70",
                        !d.inMonth && "opacity-40"
                      )}
                      data-testid={`dia-mes-${d.date}`}
                    >
                      <span className={cn("text-sm font-semibold leading-none", d.date === props.today && "text-primary")}>
                        {dayNumber(d.date)}
                      </span>
                      <span className="flex h-2 items-center gap-0.5">
                        {statuses.map((s) => (
                          <span key={s} className={cn("h-1.5 w-1.5 rounded-full", STATUS_DOT[s])} />
                        ))}
                      </span>
                      {d.items.length > 0 && (
                        <span className="text-[10px] leading-none text-muted-foreground">{d.items.length}</span>
                      )}
                    </button>
                  );
                })}
              </div>
              <ul className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" data-testid="legenda-status">
                {[
                  ["pending", "Pendente"],
                  ["confirmed", "Confirmado"],
                  ["completed", "Concluído"],
                  ["cancelled", "Cancelado"],
                ].map(([s, label]) => (
                  <li key={s} className="flex items-center gap-1.5">
                    <span className={cn("h-2 w-2 rounded-full", STATUS_DOT[s])} /> {label}
                  </li>
                ))}
                <li className="flex items-center gap-1.5">
                  <span className="h-2 w-3 rounded-sm bg-stone-300" /> Bloqueio
                </li>
              </ul>
            </div>
          )}
        </div>

        {newBooking.dialog}
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------
// PARTE 5 — Esqueleto do mês
// ---------------------------------------------------------------------
export function MonthSkeleton({ compact = false }: { compact?: boolean }) {
  return (
    <div className={cn("grid grid-cols-7", compact ? "gap-0.5" : "overflow-hidden rounded-2xl border bg-card")} aria-busy="true" aria-label="Carregando o mês">
      {Array.from({ length: 35 }, (_, i) => (
        <div key={i} className={cn(compact ? "h-14 p-1" : "h-32 border-b border-l p-1.5")}>
          <Skeleton className={cn("rounded-md", compact ? "h-full w-full" : "h-5 w-6")} />
          {!compact && i % 3 === 0 && <Skeleton className="mt-2 h-4 w-full" />}
        </div>
      ))}
    </div>
  );
}
