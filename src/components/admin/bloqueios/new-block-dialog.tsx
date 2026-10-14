"use client";

import { useState, useTransition } from "react";
import { addDays, format } from "date-fns";
import { ptBR } from "date-fns/locale";
import type { DateRange } from "react-day-picker";
import { CalendarOff, Loader2, MessageCircle, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { createBlock, type AffectedBooking } from "@/app/admin/(painel)/bloqueios/actions";
import { updateBookingStatus } from "@/app/admin/(painel)/agenda/actions";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { longDate, whatsappLink } from "@/lib/format";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------
// PARTE 1 — Constantes
// ---------------------------------------------------------------------
const TIMES = Array.from({ length: 65 }, (_, i) => {
  const m = 6 * 60 + i * 15;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
});
const DAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const ALL = "all";

function rescheduleMessage(b: AffectedBooking, businessName: string, reason: string) {
  const first = b.customer_name.split(" ")[0];
  return (
    `Olá, ${first}! Precisamos remarcar seu horário de ${b.service_name} ` +
    `(${longDate(b.booking_date)}, às ${b.start_time.slice(0, 5)})` +
    `${reason ? ` por motivo de ${reason.toLowerCase()}` : ""}. ` +
    `Qual outro dia e horário fica bom para você?\n${businessName}`
  );
}

// ---------------------------------------------------------------------
// PARTE 2 — Componente
// ---------------------------------------------------------------------
export function NewBlockDialog({
  professionals,
  businessName,
}: {
  professionals: { id: string; name: string }[];
  businessName: string;
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();

  const [mode, setMode] = useState<"dates" | "weekly">("dates");
  const [who, setWho] = useState(ALL);
  const [range, setRange] = useState<DateRange | undefined>();
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const [untilMonths, setUntilMonths] = useState("6");
  const [fullDay, setFullDay] = useState(true);
  const [timeStart, setTimeStart] = useState("");
  const [timeEnd, setTimeEnd] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const [affected, setAffected] = useState<AffectedBooking[] | null>(null);
  const [savedReason, setSavedReason] = useState("");
  const [cancelled, setCancelled] = useState<string[]>([]);

  function openDialog() {
    setMode("dates");
    setWho(ALL);
    setRange(undefined);
    setWeekdays([]);
    setFullDay(true);
    setTimeStart("");
    setTimeEnd("");
    setReason("");
    setError(null);
    setOpen(true);
  }

  function submit() {
    setError(null);
    const today = format(new Date(), "yyyy-MM-dd");
    const dateStart = mode === "dates" ? (range?.from ? format(range.from, "yyyy-MM-dd") : "") : today;
    const dateEnd =
      mode === "dates"
        ? range?.to ? format(range.to, "yyyy-MM-dd") : dateStart
        : format(addDays(new Date(), Number(untilMonths) * 30), "yyyy-MM-dd");

    start(async () => {
      const r = await createBlock({
        professionalId: who === ALL ? null : who,
        dateStart,
        dateEnd,
        timeStart: fullDay ? null : timeStart || null,
        timeEnd: fullDay ? null : timeEnd || null,
        reason,
        recurring: mode === "weekly",
        weekdays,
      });
      if (!r) return; // demonstração: o servidor redirecionou
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setOpen(false);
      if (r.affected.length > 0) {
        setSavedReason(reason);
        setCancelled([]);
        setAffected(r.affected);
      } else {
        toast.success("Bloqueio criado. Esses horários não aparecem mais na vitrine.");
      }
    });
  }

  function cancelBooking(id: string) {
    start(async () => {
      const r = await updateBookingStatus(id, "cancelled");
      if (!r) return; // demonstração: o servidor redirecionou
      if (r.ok) setCancelled((c) => [...c, id]);
      else toast.error(r.error);
    });
  }

  return (
    <>
      <Button className="h-11" onClick={openDialog} data-testid="btn-novo-bloqueio">
        <Plus className="mr-1.5 h-4 w-4" /> Novo bloqueio
      </Button>

      {/* ---------- FORMULÁRIO ---------- */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[92svh] w-[calc(100%-1.5rem)] max-w-lg overflow-y-auto rounded-2xl">
          <DialogHeader>
            <DialogTitle className="font-heading text-2xl">Novo bloqueio</DialogTitle>
            <DialogDescription>Os horários bloqueados deixam de aparecer na vitrine.</DialogDescription>
          </DialogHeader>

          <div className="space-y-5">
            <Tabs value={mode} onValueChange={(v) => setMode(v as "dates" | "weekly")}>
              <TabsList className="grid h-11 w-full grid-cols-2">
                <TabsTrigger value="dates" className="h-9" data-testid="tab-datas-especificas">Datas específicas</TabsTrigger>
                <TabsTrigger value="weekly" className="h-9" data-testid="tab-toda-semana">Toda semana</TabsTrigger>
              </TabsList>
            </Tabs>

            <div className="space-y-1.5">
              <Label>Para quem</Label>
              <Select value={who} onValueChange={setWho}>
                <SelectTrigger className="h-11" data-testid="select-bloqueio-quem"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>Toda a equipe</SelectItem>
                  {professionals.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {mode === "dates" ? (
              <div className="space-y-1.5">
                <Label>Período (toque no primeiro e no último dia)</Label>
                <div className="flex justify-center rounded-xl border">
                  <Calendar
                    mode="range"
                    locale={ptBR}
                    selected={range}
                    onSelect={setRange}
                    disabled={{ before: new Date() }}
                    data-testid="calendario-bloqueio"
                  />
                </div>
                {range?.from && (
                  <p className="text-sm text-muted-foreground">
                    {format(range.from, "dd/MM/yyyy")}
                    {range.to && range.to.getTime() !== range.from.getTime() ? ` até ${format(range.to, "dd/MM/yyyy")}` : ""}
                  </p>
                )}
              </div>
            ) : (
              <>
                <div className="space-y-1.5">
                  <Label>Dias da semana</Label>
                  <div className="grid grid-cols-7 gap-1.5">
                    {DAYS.map((d, i) => {
                      const on = weekdays.includes(i);
                      return (
                        <button
                          key={d}
                          type="button"
                          onClick={() => setWeekdays(on ? weekdays.filter((x) => x !== i) : [...weekdays, i].sort())}
                          className={cn(
                            "h-11 rounded-lg border text-sm font-semibold transition-colors",
                            on ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:border-primary"
                          )}
                          aria-pressed={on}
                          data-testid={`weekday-${i}`}
                        >
                          {d}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>Válido por</Label>
                  <Select value={untilMonths} onValueChange={setUntilMonths}>
                    <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1">1 mês</SelectItem>
                      <SelectItem value="3">3 meses</SelectItem>
                      <SelectItem value="6">6 meses</SelectItem>
                      <SelectItem value="12">1 ano</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}

            <div className="flex items-center justify-between rounded-xl border p-3">
              <Label htmlFor="full-day" className="cursor-pointer">Dia inteiro</Label>
              <Switch id="full-day" checked={fullDay} onCheckedChange={setFullDay} data-testid="switch-dia-inteiro" />
            </div>

            {!fullDay && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Das</Label>
                  <Select value={timeStart} onValueChange={setTimeStart}>
                    <SelectTrigger className="h-11"><SelectValue placeholder="--:--" /></SelectTrigger>
                    <SelectContent className="max-h-64">
                      {TIMES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Até</Label>
                  <Select value={timeEnd} onValueChange={setTimeEnd}>
                    <SelectTrigger className="h-11"><SelectValue placeholder="--:--" /></SelectTrigger>
                    <SelectContent className="max-h-64">
                      {TIMES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="reason">Motivo (aparece para a equipe)</Label>
              <Input
                id="reason"
                className="h-11"
                placeholder="Férias, folga, curso, manutenção..."
                value={reason}
                onChange={(e) => setReason(e.target.value.slice(0, 80))}
                data-testid="input-motivo-bloqueio"
              />
            </div>

            {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-destructive">{error}</p>}

            <Button className="h-12 w-full text-base" disabled={pending} onClick={submit} data-testid="btn-salvar-bloqueio">
              {pending ? <Loader2 className="h-5 w-5 animate-spin" /> : "Bloquear horários"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ---------- CLIENTES AFETADOS ---------- */}
      <Dialog open={!!affected} onOpenChange={(o) => !o && setAffected(null)}>
        <DialogContent className="max-h-[92svh] w-[calc(100%-1.5rem)] max-w-lg overflow-y-auto rounded-2xl">
          <DialogHeader>
            <div className="mb-2 grid h-12 w-12 place-items-center rounded-full bg-amber-100 text-amber-700">
              <CalendarOff className="h-6 w-6" />
            </div>
            <DialogTitle className="font-heading text-2xl">
              {affected?.length === 1 ? "1 cliente já estava marcado" : `${affected?.length} clientes já estavam marcados`}
            </DialogTitle>
            <DialogDescription>
              O bloqueio foi criado. Avise cada cliente pelo WhatsApp para remarcar e, se quiser, cancele o horário antigo.
            </DialogDescription>
          </DialogHeader>

          <ul className="space-y-3" data-testid="lista-afetados">
            {affected?.map((b) => {
              const done = cancelled.includes(b.id);
              const wa = whatsappLink(b.customer_phone, rescheduleMessage(b, businessName, savedReason));
              return (
                <li key={b.id} className={cn("rounded-xl border p-4", done && "opacity-50")}>
                  <p className="font-semibold">{b.customer_name}</p>
                  <p className="text-sm text-muted-foreground first-letter:uppercase">
                    {longDate(b.booking_date)}, {b.start_time.slice(0, 5)} · {b.service_name} com {b.professional_name}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {wa && (
                      <Button asChild size="sm" className="h-10 bg-whatsapp text-white hover:bg-whatsapp-hover">
                        <a href={wa} target="_blank" rel="noopener noreferrer" data-testid={`btn-avisar-${b.id}`}>
                          <MessageCircle className="mr-1.5 h-4 w-4" /> Avisar e remarcar
                        </a>
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-10 text-destructive hover:bg-red-50 hover:text-destructive"
                      disabled={done || pending}
                      onClick={() => cancelBooking(b.id)}
                      data-testid={`btn-cancelar-afetado-${b.id}`}
                    >
                      <X className="mr-1.5 h-4 w-4" /> {done ? "Cancelado" : "Cancelar horário"}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>

          <Button variant="outline" className="h-11" onClick={() => setAffected(null)}>
            Concluir
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}
