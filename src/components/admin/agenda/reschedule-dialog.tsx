"use client";

import { useEffect, useState, useTransition } from "react";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { CalendarDays, CheckCircle2, Loader2, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { listRescheduleSlots, rescheduleBooking } from "@/app/admin/(painel)/agenda/actions";
import type { AgendaBooking } from "@/components/admin/agenda/booking-actions";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { longDate, whatsappLink } from "@/lib/format";
import { rescheduleMessage } from "@/lib/messages";
import { cn } from "@/lib/utils";

/** serviceIds null = faz todos os serviços (sem vínculos cadastrados) */
export type ProOption = { id: string; name: string; serviceIds: string[] | null };

export function RescheduleDialog({
  open,
  onOpenChange,
  booking: b,
  businessName,
  professionals,
  canChooseProfessional,
  today,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  booking: AgendaBooking;
  businessName: string;
  professionals: ProOption[];
  /** matriz e recepção: trocam o profissional e podem encaixar */
  canChooseProfessional: boolean;
  today: string;
}) {
  const [pending, start] = useTransition();
  const [calOpen, setCalOpen] = useState(false);
  const [professionalId, setProfessionalId] = useState(b.professional_id);
  const [date, setDate] = useState(b.booking_date);
  const [time, setTime] = useState("");
  const [fit, setFit] = useState(false);
  const [fitTime, setFitTime] = useState("");
  const [slots, setSlots] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ date: string; time: string; professional: string } | null>(null);
  const [loadedFor, setLoadedFor] = useState<boolean>(false);

  // abre sempre a partir do agendamento atual
  if (open && !loadedFor) {
    setLoadedFor(true);
    setProfessionalId(b.professional_id);
    setDate(b.booking_date < today ? today : b.booking_date);
    setTime("");
    setFit(false);
    setFitTime("");
    setError(null);
    setDone(null);
  }
  if (!open && loadedFor) setLoadedFor(false);

  const pros = professionals.filter((p) => !b.service_id || !p.serviceIds || p.serviceIds.includes(b.service_id));

  // horários livres do profissional escolhido no dia
  useEffect(() => {
    if (!open || done || !professionalId) return;
    let alive = true;
    setError(null);
    setSlots(null);
    setTime("");
    listRescheduleSlots(b.id, professionalId, date).then((r) => {
      if (!alive || !r) return;
      if (r.ok) setSlots(r.slots);
      else {
        setSlots([]);
        setError(r.error);
      }
    });
    return () => {
      alive = false;
    };
  }, [open, done, b.id, professionalId, date]);

  const chosen = fit ? fitTime : time;

  function save() {
    setError(null);
    if (!/^\d{2}:\d{2}$/.test(chosen)) return setError("Escolha o horário.");
    start(async () => {
      const r = await rescheduleBooking({ bookingId: b.id, professionalId, date, time: chosen, fit });
      if (!r) return; // demonstração: o servidor redirecionou
      if (r.ok) {
        toast.success("Agendamento remarcado");
        setDone({ date: r.date, time: r.time, professional: r.professional });
      } else setError(r.error);
    });
  }

  const wa = done
    ? whatsappLink(
        b.customer_phone,
        rescheduleMessage(
          { ...b, booking_date: done.date, start_time: done.time, professional_name: done.professional },
          businessName
        )
      )
    : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92svh] w-[calc(100%-1.5rem)] max-w-md overflow-y-auto rounded-2xl">
        <DialogHeader>
          <DialogTitle className="font-heading text-2xl">{done ? "Remarcado" : "Remarcar"}</DialogTitle>
          <DialogDescription>
            {b.service_name} de {b.customer_name} · hoje em {longDate(b.booking_date)}, às {b.start_time.slice(0, 5)}
          </DialogDescription>
        </DialogHeader>

        {done ? (
          <div className="space-y-4" data-testid="remarcar-concluido">
            <p className="flex items-start gap-2 rounded-xl bg-green-50 p-3 text-sm text-green-900">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                Novo horário: <strong className="first-letter:uppercase">{longDate(done.date)}</strong>, às {done.time}, com {done.professional}.
              </span>
            </p>
            {wa && (
              <Button asChild className="h-12 w-full bg-whatsapp text-base text-white hover:bg-whatsapp-hover">
                <a href={wa} target="_blank" rel="noopener noreferrer" data-testid={`btn-avisar-remarcacao-${b.id}`}>
                  <MessageCircle className="mr-1.5 h-4 w-4" /> Avisar cliente no WhatsApp
                </a>
              </Button>
            )}
            <Button variant="ghost" className="h-11 w-full" onClick={() => onOpenChange(false)} data-testid="btn-fechar-remarcar">
              Fechar
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            {canChooseProfessional && (
              <div className="space-y-1.5">
                <Label>Profissional</Label>
                <Select value={professionalId} onValueChange={setProfessionalId}>
                  <SelectTrigger className="h-11" data-testid="select-remarcar-profissional"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {pros.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-1.5">
              <Label>Data</Label>
              <Popover open={calOpen} onOpenChange={setCalOpen}>
                <PopoverTrigger asChild>
                  <Button type="button" variant="outline" className="h-11 w-full justify-start gap-2 font-normal" data-testid="btn-remarcar-data">
                    <CalendarDays className="h-4 w-4 text-primary" />
                    {format(parseISO(date), "EEE, dd/MM/yyyy", { locale: ptBR })}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    locale={ptBR}
                    selected={parseISO(date)}
                    disabled={{ before: parseISO(today) }}
                    onSelect={(d) => {
                      if (!d) return;
                      setDate(format(d, "yyyy-MM-dd"));
                      setCalOpen(false);
                    }}
                  />
                </PopoverContent>
              </Popover>
            </div>

            {!fit && (
              <div className="space-y-1.5">
                <Label>Horários livres</Label>
                {slots === null ? (
                  <p className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" /> Buscando horários…
                  </p>
                ) : slots.length === 0 ? (
                  <p className="rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground">
                    Nenhum horário livre nesse dia.
                  </p>
                ) : (
                  <div className="grid grid-cols-4 gap-2" data-testid="remarcar-horarios">
                    {slots.map((s) => (
                      <Button
                        key={s}
                        type="button"
                        variant={time === s ? "default" : "outline"}
                        className={cn("h-11 px-0", time === s && "ring-2 ring-primary/30")}
                        onClick={() => setTime(s)}
                        data-testid={`horario-remarcar-${s.replace(":", "")}`}
                      >
                        {s}
                      </Button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {canChooseProfessional && (
              <div className="space-y-2 rounded-xl border p-3">
                <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm font-semibold">
                  <input
                    type="checkbox"
                    className="h-5 w-5 accent-primary"
                    checked={fit}
                    onChange={(e) => setFit(e.target.checked)}
                    data-testid="check-encaixar"
                  />
                  Encaixar outro horário
                </label>
                {fit && (
                  <div className="space-y-1.5">
                    <Input
                      type="time"
                      className="h-11 w-36"
                      value={fitTime}
                      onChange={(e) => setFitTime(e.target.value.slice(0, 5))}
                      data-testid="input-encaixe-horario"
                    />
                    <p className="text-xs text-muted-foreground">
                      Pode ser fora do expediente. Bloqueios e horários ocupados continuam valendo.
                    </p>
                  </div>
                )}
              </div>
            )}

            {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-destructive">{error}</p>}

            <Button className="h-12 w-full text-base" disabled={pending || !chosen} onClick={save} data-testid="btn-salvar-remarcacao">
              {pending ? <Loader2 className="h-5 w-5 animate-spin" /> : chosen ? `Remarcar para ${chosen}` : "Escolha o horário"}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
