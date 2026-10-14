"use client";

import { useState, useTransition } from "react";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { CalendarDays, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { createManualBooking } from "@/app/admin/(painel)/agenda/actions";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { brl, duration, maskPhone } from "@/lib/format";

type Props = {
  defaultDate: string;
  services: { id: string; name: string; price: number; duration_min: number }[];
  professionals: { id: string; name: string }[];
};

// 06:00 até 22:00, de 15 em 15 minutos
const TIMES = Array.from({ length: 65 }, (_, i) => {
  const m = 6 * 60 + i * 15;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
});

export function NewBookingDialog({ defaultDate, services, professionals }: Props) {
  const [open, setOpen] = useState(false);
  const [calOpen, setCalOpen] = useState(false);
  const [pending, start] = useTransition();

  const [serviceId, setServiceId] = useState("");
  const [professionalId, setProfessionalId] = useState(professionals.length === 1 ? professionals[0].id : "");
  const [date, setDate] = useState(defaultDate);
  const [time, setTime] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  function openDialog() {
    setDate(defaultDate);
    setTime("");
    setName("");
    setPhone("");
    setNotes("");
    setError(null);
    setOpen(true);
  }

  function submit() {
    setError(null);
    start(async () => {
      const r = await createManualBooking({
        serviceId, professionalId, date, time, customerName: name, customerPhone: phone, notes,
      });
      if (!r) return; // demonstração: o servidor redirecionou
      if (r.ok) {
        toast.success("Agendamento criado");
        setOpen(false);
      } else {
        setError(r.error);
      }
    });
  }

  return (
    <>
      <Button className="h-11" onClick={openDialog} data-testid="btn-novo-agendamento">
        <Plus className="mr-1.5 h-4 w-4" /> Novo agendamento
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[92svh] w-[calc(100%-1.5rem)] max-w-lg overflow-y-auto rounded-2xl">
          <DialogHeader>
            <DialogTitle className="font-heading text-2xl">Novo agendamento</DialogTitle>
            <DialogDescription>Para clientes que marcaram por telefone ou no balcão. Já entra como confirmado.</DialogDescription>
          </DialogHeader>

          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <div className="space-y-1.5">
              <Label>Serviço</Label>
              <Select value={serviceId} onValueChange={setServiceId}>
                <SelectTrigger className="h-11" data-testid="select-servico-manual"><SelectValue placeholder="Escolha o serviço" /></SelectTrigger>
                <SelectContent>
                  {services.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name} · {duration(s.duration_min)} · {brl(s.price)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Profissional</Label>
              <Select value={professionalId} onValueChange={setProfessionalId}>
                <SelectTrigger className="h-11" data-testid="select-profissional-manual"><SelectValue placeholder="Escolha o profissional" /></SelectTrigger>
                <SelectContent>
                  {professionals.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Data</Label>
                <Popover open={calOpen} onOpenChange={setCalOpen}>
                  <PopoverTrigger asChild>
                    <Button type="button" variant="outline" className="h-11 w-full justify-start gap-2 font-normal" data-testid="btn-data-manual">
                      <CalendarDays className="h-4 w-4 text-primary" />
                      {format(parseISO(date), "dd/MM/yyyy", { locale: ptBR })}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      locale={ptBR}
                      selected={parseISO(date)}
                      onSelect={(d) => {
                        if (!d) return;
                        setDate(format(d, "yyyy-MM-dd"));
                        setCalOpen(false);
                      }}
                    />
                  </PopoverContent>
                </Popover>
              </div>
              <div className="space-y-1.5">
                <Label>Horário</Label>
                <Select value={time} onValueChange={setTime}>
                  <SelectTrigger className="h-11" data-testid="select-horario-manual"><SelectValue placeholder="--:--" /></SelectTrigger>
                  <SelectContent className="max-h-64">
                    {TIMES.map((t) => (
                      <SelectItem key={t} value={t}>{t}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="nb-name">Nome do cliente</Label>
                <Input id="nb-name" className="h-11" value={name} onChange={(e) => setName(e.target.value)} data-testid="input-nome-manual" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="nb-phone">WhatsApp</Label>
                <Input
                  id="nb-phone"
                  className="h-11"
                  inputMode="tel"
                  placeholder="(35) 99999-9999"
                  value={phone}
                  onChange={(e) => setPhone(maskPhone(e.target.value))}
                  data-testid="input-whatsapp-manual"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="nb-notes">Observações (opcional)</Label>
              <Textarea id="nb-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value.slice(0, 500))} />
            </div>

            {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-destructive">{error}</p>}

            <Button
              type="submit"
              className="h-12 w-full text-base"
              disabled={pending || !serviceId || !professionalId || !time}
              data-testid="btn-salvar-agendamento-manual"
            >
              {pending ? <Loader2 className="h-5 w-5 animate-spin" /> : "Salvar agendamento"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
