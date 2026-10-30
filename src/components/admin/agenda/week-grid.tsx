"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Package, Repeat } from "lucide-react";
import { toast } from "sonner";
import { rescheduleBooking } from "@/app/admin/(painel)/agenda/actions";
import { BookingActions, type RescheduleProps } from "@/components/admin/agenda/booking-actions";
import { NewBookingDialog } from "@/components/admin/agenda/new-booking-dialog";
import { StatusBadge } from "@/components/admin/status-badge";
import { AutoConfirmBadge } from "@/components/admin/auto-confirm-badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { addDaysISO } from "@/lib/dates";
import { brl, maskPhone } from "@/lib/format";
import { blockAppliesOn, type AgendaBlock, type AgendaHour, type AgendaItem } from "@/lib/agenda";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------
// PARTE 1 — Tipos, constantes e utilidades
// ---------------------------------------------------------------------
type Props = {
  weekStart: string; // segunda-feira
  today: string;
  bookings: AgendaItem[];
  sessionLabel: Record<string, string>;
  blocks: AgendaBlock[];
  hours: AgendaHour[];
  slotStep: number;
  professionals: { id: string; name: string }[];
  /** "Todos os profissionais" (matriz/recepção): cor por profissional + legenda */
  showProfessionalColors: boolean;
  /** profissional filtrado (staff: sempre o próprio) */
  selectedProfessional: string | null;
  services: { id: string; name: string; price: number; duration_min: number }[];
  /** demonstração (viewer) = false: sem arrastar */
  canEdit: boolean;
  fullAccess: boolean;
  businessName: string;
  slug: string;
  reschedule: RescheduleProps;
};

const ROW = 44; // px por passo da agenda (alvo de toque)
const DRAG_THRESHOLD = 5; // px: menos que isso é clique

// cor por profissional (borda do bloco + legenda)
const PRO_COLORS = ["#99582A", "#2563EB", "#16A34A", "#9333EA", "#DB2777", "#0891B2", "#CA8A04", "#4B5563"];

const STATUS_STYLE: Record<string, string> = {
  pending: "bg-amber-50 border-amber-300 text-amber-950",
  confirmed: "bg-blue-50 border-blue-300 text-blue-950",
  completed: "bg-green-50 border-green-300 text-green-950",
  cancelled: "bg-red-50 border-red-200 text-red-900 opacity-60 line-through decoration-red-300",
};

const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const toTime = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const weekdayOf = (iso: string) => new Date(`${iso}T12:00:00Z`).getUTCDay();

type Placed = { b: AgendaItem; start: number; end: number; lane: number; lanes: number };

/** Lado a lado: agrupa os que se cruzam e divide a largura em faixas */
function placeOverlaps(items: AgendaItem[]): Placed[] {
  const sorted = items
    .map((b) => ({ b, start: toMin(b.start_time), end: toMin(b.end_time) }))
    .sort((x, y) => x.start - y.start || y.end - x.end);
  const out: Placed[] = [];
  let group: Placed[] = [];
  let groupEnd = -1;
  const flush = () => {
    const lanes = Math.max(1, ...group.map((g) => g.lane + 1));
    group.forEach((g) => out.push({ ...g, lanes }));
    group = [];
  };
  for (const it of sorted) {
    if (group.length && it.start >= groupEnd) flush();
    const laneEnds: number[] = [];
    group.forEach((g) => (laneEnds[g.lane] = Math.max(laneEnds[g.lane] ?? -1, g.end)));
    let lane = laneEnds.findIndex((e) => e <= it.start);
    if (lane < 0) lane = laneEnds.length;
    group.push({ ...it, lane, lanes: 1 });
    groupEnd = Math.max(groupEnd, it.end);
  }
  if (group.length) flush();
  return out;
}

type Drag = {
  id: string;
  startX: number;
  startY: number;
  grabOffset: number; // px entre o topo do bloco e o ponteiro
  duration: number;
  moved: boolean;
  target: { date: string; start: number } | null;
};

// ---------------------------------------------------------------------
// PARTE 2 — Componente
// ---------------------------------------------------------------------
export function WeekGrid(props: Props) {
  const { weekStart, today, bookings, blocks, hours, slotStep, professionals, selectedProfessional } = props;
  const router = useRouter();
  const [, startTransition] = useTransition();

  const [selected, setSelected] = useState<AgendaItem | null>(null);
  const [newSlot, setNewSlot] = useState<{ date: string; time: string; professionalId: string | null } | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  // remarcação em andamento: mostra o bloco no destino até o servidor responder
  const [moving, setMoving] = useState<{ id: string; date: string; start: number } | null>(null);
  const [finePointer, setFinePointer] = useState(false);
  const columns = useRef(new Map<string, HTMLDivElement>());
  const justDragged = useRef(false);

  // arrastar só com mouse (desktop)
  useEffect(() => {
    const mq = window.matchMedia("(pointer: fine)");
    const update = () => setFinePointer(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  const canDrag = props.canEdit && finePointer;

  const colorOf = useMemo(
    () => new Map(professionals.map((p, i) => [p.id, PRO_COLORS[i % PRO_COLORS.length]])),
    [professionals]
  );

  // ----------------------- dias, faixa de horas -----------------------
  const layout = useMemo(() => {
    const allDays = Array.from({ length: 7 }, (_, i) => addDaysISO(weekStart, i));
    const hourOf = new Map(hours.map((h) => [h.weekday, h]));

    const days = allDays.map((date) => {
      const h = hourOf.get(weekdayOf(date));
      const closed = !h || h.closed || !h.open_time || !h.close_time;
      const items = bookings.filter((b) => b.booking_date === date);
      const dayBlocks = blocks.filter(
        (k) =>
          blockAppliesOn(k, date) &&
          (!selectedProfessional || !k.professional_id || k.professional_id === selectedProfessional)
      );
      return {
        date,
        closed,
        open: closed ? null : toMin(h!.open_time!),
        close: closed ? null : toMin(h!.close_time!),
        items,
        blocks: dayBlocks,
      };
    });

    // dia fechado só some se não tiver nada (encaixe num domingo fechado aparece)
    const visible = days.filter((d) => !d.closed || d.items.length > 0 || d.blocks.length > 0);

    // faixa = expediente ∪ agendamentos ∪ bloqueios com horário (encaixe às 20:30 aparece)
    const starts: number[] = [];
    const ends: number[] = [];
    for (const d of visible) {
      if (d.open !== null && d.close !== null) {
        starts.push(d.open);
        ends.push(d.close);
      }
      d.items.forEach((b) => {
        starts.push(toMin(b.start_time));
        ends.push(toMin(b.end_time));
      });
      d.blocks.forEach((k) => {
        if (k.time_start && k.time_end) {
          starts.push(toMin(k.time_start));
          ends.push(toMin(k.time_end));
        }
      });
    }
    let from = starts.length ? Math.min(...starts) : 8 * 60;
    let to = ends.length ? Math.max(...ends) : 18 * 60;
    from = Math.floor(from / slotStep) * slotStep;
    to = Math.min(24 * 60, Math.ceil(to / slotStep) * slotStep);
    if (to <= from) to = from + slotStep;

    return { days: visible, from, to, rows: (to - from) / slotStep };
  }, [weekStart, hours, bookings, blocks, selectedProfessional, slotStep]);

  const { from, rows } = layout;
  const heightOf = (minutes: number) => (minutes / slotStep) * ROW;
  const topOf = (minute: number) => heightOf(minute - from);

  // ----------------------------- arrastar -----------------------------
  function targetAt(clientX: number, clientY: number, d: Drag) {
    for (const [date, el] of Array.from(columns.current.entries())) {
      const r = el.getBoundingClientRect();
      if (clientX < r.left || clientX > r.right) continue;
      const raw = from + ((clientY - r.top - d.grabOffset) / ROW) * slotStep;
      let start = Math.round(raw / slotStep) * slotStep;
      start = Math.max(from, Math.min(start, layout.to - d.duration));
      return { date, start };
    }
    return d.target;
  }

  function onPointerDown(e: React.PointerEvent<HTMLButtonElement>, b: AgendaItem) {
    if (!canDrag || e.button !== 0 || !["pending", "confirmed"].includes(b.status) || moving) return;
    const rect = e.currentTarget.getBoundingClientRect();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({
      id: b.id,
      startX: e.clientX,
      startY: e.clientY,
      grabOffset: e.clientY - rect.top,
      duration: toMin(b.end_time) - toMin(b.start_time),
      moved: false,
      target: null,
    });
  }

  function onPointerMove(e: React.PointerEvent<HTMLButtonElement>) {
    if (!drag) return;
    const moved = drag.moved || Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) > DRAG_THRESHOLD;
    if (!moved) return;
    setDrag({ ...drag, moved, target: targetAt(e.clientX, e.clientY, drag) });
  }

  function onPointerUp(b: AgendaItem) {
    const d = drag;
    setDrag(null);
    if (!d?.moved) return;
    justDragged.current = true; // o click que vem depois não abre as ações
    const t = d.target;
    if (!t || (t.date === b.booking_date && t.start === toMin(b.start_time))) return;

    setMoving({ id: b.id, date: t.date, start: t.start });
    startTransition(async () => {
      const r = await rescheduleBooking({
        bookingId: b.id,
        professionalId: b.professional_id,
        date: t.date,
        time: toTime(t.start),
        fit: false,
      });
      if (!r) {
        setMoving(null); // demonstração: o servidor redirecionou
        return;
      }
      if (!r.ok) {
        setMoving(null); // volta ao lugar
        toast.error("Não foi possível remarcar", { description: r.error });
        return;
      }
      toast.success(`Remarcado para ${format(parseISO(r.date), "dd/MM")} às ${r.time}`);
      router.refresh();
    });
  }

  // limpa o estado otimista quando os dados novos chegam
  useEffect(() => setMoving(null), [bookings]);

  // ------------------------------ render ------------------------------
  const defaultPro = selectedProfessional ?? (professionals.length === 1 ? professionals[0].id : null);

  return (
    <div className="space-y-3">
      {props.showProfessionalColors && (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm" data-testid="legenda-profissionais">
          {professionals.map((p) => (
            <li key={p.id} className="flex items-center gap-1.5">
              <span className="h-3 w-3 rounded-full" style={{ background: colorOf.get(p.id) }} /> {p.name}
            </li>
          ))}
        </ul>
      )}

      {canDrag && (
        <p className="text-xs text-muted-foreground">Dica: arraste um agendamento para remarcar.</p>
      )}

      {layout.days.length === 0 ? (
        <div className="rounded-2xl border border-dashed bg-white p-10 text-center">
          <p className="font-heading text-2xl">Semana sem expediente</p>
          <p className="mt-2 text-muted-foreground">Todos os dias estão fechados e não há agendamentos.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border bg-card" data-testid="grade-semana">
          <div
            className="grid min-w-max"
            style={{ gridTemplateColumns: `3.5rem repeat(${layout.days.length}, minmax(9.5rem, 1fr))` }}
          >
            {/* cabeçalho */}
            <div className="sticky left-0 z-20 border-b bg-card" />
            {layout.days.map((d) => (
              <div
                key={d.date}
                className={cn("border-b border-l px-2 py-2 text-center", d.date === today && "bg-secondary")}
                data-testid={`cabecalho-dia-${d.date}`}
              >
                <p className="text-xs font-semibold uppercase text-muted-foreground">
                  {format(parseISO(d.date), "EEE", { locale: ptBR })}
                </p>
                <p className={cn("text-lg font-semibold", d.date === today && "text-primary")}>
                  {format(parseISO(d.date), "dd/MM")}
                </p>
                {d.closed && <p className="text-[11px] text-muted-foreground">Fechado</p>}
              </div>
            ))}

            {/* coluna de horas */}
            <div className="sticky left-0 z-20 bg-card" style={{ height: rows * ROW }}>
              {Array.from({ length: rows }, (_, i) => (
                <div key={i} className="relative border-b border-dashed text-right" style={{ height: ROW }}>
                  <span className="absolute -top-2 right-1.5 bg-card px-0.5 text-[11px] text-muted-foreground">
                    {i > 0 ? toTime(from + i * slotStep) : ""}
                  </span>
                </div>
              ))}
            </div>

            {/* dias */}
            {layout.days.map((d) => {
              const placed = placeOverlaps(d.items.filter((b) => b.id !== moving?.id));
              const ghostMoving = moving && moving.date === d.date ? bookings.find((b) => b.id === moving.id) : null;
              const ghostDrag =
                drag?.moved && drag.target?.date === d.date ? bookings.find((b) => b.id === drag.id) : null;

              return (
                <div
                  key={d.date}
                  ref={(el) => {
                    if (el) columns.current.set(d.date, el);
                    else columns.current.delete(d.date);
                  }}
                  className="relative border-l"
                  style={{ height: rows * ROW }}
                >
                  {/* horários vazios (clique = novo agendamento) */}
                  {Array.from({ length: rows }, (_, i) => {
                    const m = from + i * slotStep;
                    const outside = d.open === null || d.close === null || m < d.open || m >= d.close;
                    const time = toTime(m);
                    return (
                      <button
                        key={i}
                        type="button"
                        className={cn(
                          "absolute inset-x-0 border-b border-dashed text-left transition-colors hover:bg-primary/5 focus-visible:bg-primary/10 focus-visible:outline-none",
                          outside && "bg-stone-100/70"
                        )}
                        style={{ top: i * ROW, height: ROW }}
                        onClick={() => setNewSlot({ date: d.date, time, professionalId: defaultPro })}
                        aria-label={`Novo agendamento em ${format(parseISO(d.date), "dd/MM")} às ${time}`}
                        data-testid={`slot-vazio-${d.date}-${time.replace(":", "")}`}
                      />
                    );
                  })}

                  {/* bloqueios: faixa cinza listrada */}
                  {d.blocks.map((k, i) => {
                    const s = k.time_start ? toMin(k.time_start) : from;
                    const e = k.time_end ? toMin(k.time_end) : layout.to;
                    const who = k.professional_id
                      ? professionals.find((p) => p.id === k.professional_id)?.name ?? "um profissional"
                      : "toda a equipe";
                    const label = `${k.reason ?? "Bloqueio"} — ${who}${
                      k.time_start ? `, ${k.time_start.slice(0, 5)}–${k.time_end?.slice(0, 5)}` : ", dia inteiro"
                    }`;
                    return (
                      <div
                        key={i}
                        title={label}
                        aria-label={label}
                        role="img"
                        className="absolute inset-x-0 z-[1] border-y border-stone-300"
                        style={{
                          top: topOf(s),
                          height: heightOf(e - s),
                          backgroundImage:
                            "repeating-linear-gradient(45deg, rgba(120,113,108,.18) 0 6px, rgba(120,113,108,.06) 6px 12px)",
                        }}
                        data-testid={`faixa-bloqueio-${d.date}-${i}`}
                      >
                        <span className="m-1 inline-block max-w-[calc(100%-0.5rem)] truncate rounded bg-white/80 px-1 text-[11px] text-stone-700">
                          {k.reason ?? "Bloqueio"}
                        </span>
                      </div>
                    );
                  })}

                  {/* agendamentos */}
                  {placed.map((p) => (
                    <BookingBlock
                      key={p.b.id}
                      p={p}
                      top={topOf(p.start)}
                      height={heightOf(p.end - p.start)}
                      color={props.showProfessionalColors ? colorOf.get(p.b.professional_id) : undefined}
                      label={props.sessionLabel[p.b.id]}
                      draggable={canDrag && ["pending", "confirmed"].includes(p.b.status)}
                      dragging={drag?.moved === true && drag.id === p.b.id}
                      onPointerDown={(e) => onPointerDown(e, p.b)}
                      onPointerMove={onPointerMove}
                      onPointerUp={() => onPointerUp(p.b)}
                      onPointerCancel={() => setDrag(null)}
                      onClick={() => {
                        if (justDragged.current) {
                          justDragged.current = false;
                          return;
                        }
                        setSelected(p.b);
                      }}
                    />
                  ))}

                  {/* destino do arraste / remarcação aguardando o servidor */}
                  {ghostDrag && drag?.target && (
                    <Ghost top={topOf(drag.target.start)} height={heightOf(drag.duration)} text={toTime(drag.target.start)} />
                  )}
                  {ghostMoving && moving && (
                    <Ghost
                      top={topOf(moving.start)}
                      height={heightOf(toMin(ghostMoving.end_time) - toMin(ghostMoving.start_time))}
                      text={`${toTime(moving.start)} · ${ghostMoving.customer_name}`}
                      saving
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ações do agendamento (as mesmas da visão Dia) */}
      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="max-h-[92svh] w-[calc(100%-1.5rem)] max-w-lg overflow-y-auto rounded-2xl">
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle className="font-heading text-2xl">{selected.customer_name}</DialogTitle>
                <DialogDescription>
                  {format(parseISO(selected.booking_date), "EEEE, dd/MM", { locale: ptBR })} ·{" "}
                  {selected.start_time.slice(0, 5)}–{selected.end_time.slice(0, 5)}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-1 text-sm" data-testid="detalhe-agendamento">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={selected.status} />
                  <AutoConfirmBadge status={selected.status} reason={selected.auto_confirm_reason} testId="selo-auto-confirmado-semana" />
                  {selected.series_id && <Badge icon={<Repeat className="h-3 w-3" />}>Recorrente</Badge>}
                  {selected.customer_package_id && (
                    <Badge icon={<Package className="h-3 w-3" />}>{props.sessionLabel[selected.id] ?? "Pacote"}</Badge>
                  )}
                </div>
                <p>
                  {selected.service_name} com {selected.professional_name}
                  {!selected.customer_package_id && <span className="text-muted-foreground"> · {brl(selected.price)}</span>}
                </p>
                <p className="text-muted-foreground">{maskPhone(selected.customer_phone)}</p>
                {selected.customer_notes && <p className="rounded-lg bg-secondary px-2.5 py-1.5">{selected.customer_notes}</p>}
              </div>
              <div className="border-t pt-3">
                <BookingActions
                  booking={selected}
                  businessName={props.businessName}
                  slug={props.slug}
                  fullAccess={props.fullAccess}
                  reschedule={props.reschedule}
                />
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* novo agendamento num horário vazio (reaproveita o diálogo da Agenda) */}
      <NewBookingDialog
        defaultDate={newSlot?.date ?? today}
        services={props.services}
        professionals={professionals}
        fullAccess={props.fullAccess}
        open={!!newSlot}
        onOpenChange={(o) => !o && setNewSlot(null)}
        initial={newSlot ?? undefined}
      />
    </div>
  );
}

// ---------------------------------------------------------------------
// PARTE 3 — Subcomponentes
// ---------------------------------------------------------------------
function BookingBlock(props: {
  p: Placed;
  top: number;
  height: number;
  color?: string;
  label?: string;
  draggable: boolean;
  dragging: boolean;
  onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => void;
  onPointerMove: (e: React.PointerEvent<HTMLButtonElement>) => void;
  onPointerUp: () => void;
  onPointerCancel: () => void;
  onClick: () => void;
}) {
  const { b, lane, lanes } = props.p;
  const compact = props.height < 60;
  return (
    <button
      type="button"
      className={cn(
        "absolute z-[2] overflow-hidden rounded-lg border px-1.5 py-1 text-left text-xs shadow-sm transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
        STATUS_STYLE[b.status],
        props.draggable && "cursor-grab touch-none active:cursor-grabbing",
        props.dragging && "opacity-40"
      )}
      style={{
        top: props.top + 1,
        height: Math.max(props.height - 2, 24),
        left: `calc(${(lane / lanes) * 100}% + 2px)`,
        width: `calc(${100 / lanes}% - 4px)`,
        borderLeft: props.color ? `4px solid ${props.color}` : undefined,
      }}
      onPointerDown={props.onPointerDown}
      onPointerMove={props.onPointerMove}
      onPointerUp={props.onPointerUp}
      onPointerCancel={props.onPointerCancel}
      onClick={props.onClick}
      aria-label={`${b.start_time.slice(0, 5)} a ${b.end_time.slice(0, 5)}, ${b.customer_name}, ${b.service_name}, ${b.professional_name}`}
      data-testid={`bloco-agendamento-${b.id}`}
    >
      <p className="truncate font-semibold">
        {b.start_time.slice(0, 5)}–{b.end_time.slice(0, 5)} {compact && <span className="font-normal">{b.customer_name}</span>}
      </p>
      {!compact && (
        <>
          <p className="truncate font-medium">{b.customer_name}</p>
          <p className="truncate opacity-80">{b.service_name}</p>
          <div className="mt-0.5 flex flex-wrap gap-1">
            {b.customer_package_id && (
              <Badge icon={<Package className="h-3 w-3" />} testId={`selo-pacote-${b.id}`}>
                {props.label ?? "Pacote"}
              </Badge>
            )}
            {b.series_id && (
              <Badge icon={<Repeat className="h-3 w-3" />} testId={`selo-recorrente-${b.id}`}>
                Recorrente
              </Badge>
            )}
          </div>
        </>
      )}
    </button>
  );
}

function Badge({ icon, children, testId }: { icon: React.ReactNode; children: React.ReactNode; testId?: string }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full bg-white/80 px-1.5 py-0.5 text-[11px] font-medium text-primary"
      data-testid={testId}
    >
      {icon} {children}
    </span>
  );
}

function Ghost({ top, height, text, saving = false }: { top: number; height: number; text: string; saving?: boolean }) {
  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-x-0.5 z-[3] rounded-lg border-2 border-dashed border-primary bg-primary/10 px-1.5 py-1 text-xs font-semibold text-primary",
        saving && "animate-pulse"
      )}
      style={{ top: top + 1, height: Math.max(height - 2, 24) }}
    >
      {saving ? `Salvando… ${text}` : text}
    </div>
  );
}
