"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { updateHours } from "@/app/admin/(painel)/configuracoes/actions";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { WEEKDAYS } from "@/lib/format";
import { cn } from "@/lib/utils";

type Hour = { weekday: number; closed: boolean; open_time: string; close_time: string };

const TIMES = Array.from({ length: 73 }, (_, i) => {
  const m = 5 * 60 + i * 15; // 05:00 até 23:00
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
});

const NOTICE = [
  { v: 0, l: "Sem antecedência" },
  { v: 30, l: "30 minutos" },
  { v: 60, l: "1 hora" },
  { v: 120, l: "2 horas" },
  { v: 240, l: "4 horas" },
  { v: 720, l: "12 horas" },
  { v: 1440, l: "1 dia" },
  { v: 2880, l: "2 dias" },
];

// segunda primeiro, domingo por último (como o brasileiro lê a semana)
const ORDER = [1, 2, 3, 4, 5, 6, 0];

export function HoursForm({
  initial,
  slotStep,
  noticeMin,
}: {
  initial: Hour[];
  slotStep: number;
  noticeMin: number;
}) {
  const [pending, start] = useTransition();
  const [hours, setHours] = useState<Hour[]>(() =>
    Array.from({ length: 7 }, (_, d) => {
      const h = initial.find((x) => x.weekday === d);
      return {
        weekday: d,
        closed: h?.closed ?? true,
        open_time: h?.open_time?.slice(0, 5) || "09:00",
        close_time: h?.close_time?.slice(0, 5) || "18:00",
      };
    })
  );
  const [step, setStep] = useState(String(slotStep));
  const [notice, setNotice] = useState(String(noticeMin));

  const update = (d: number, patch: Partial<Hour>) =>
    setHours((list) => list.map((h) => (h.weekday === d ? { ...h, ...patch } : h)));

  function copyMonday() {
    const mon = hours.find((h) => h.weekday === 1)!;
    setHours((list) =>
      list.map((h) => (h.weekday >= 2 && h.weekday <= 5 ? { ...h, closed: mon.closed, open_time: mon.open_time, close_time: mon.close_time } : h))
    );
    toast.success("Horário de segunda copiado para terça a sexta");
  }

  function save() {
    start(async () => {
      const r = await updateHours({ hours, slotStep: Number(step), noticeMin: Number(notice) });
      if (r.ok) toast.success("Horários salvos");
      else toast.error(r.error);
    });
  }

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <ul className="divide-y rounded-xl border">
        {ORDER.map((d) => {
          const h = hours.find((x) => x.weekday === d)!;
          return (
            <li key={d} className="flex flex-wrap items-center gap-3 p-3 sm:flex-nowrap" data-testid={`horario-dia-${d}`}>
              <label className="flex w-36 cursor-pointer items-center gap-3">
                <Switch checked={!h.closed} onCheckedChange={(v) => update(d, { closed: !v })} data-testid={`switch-aberto-${d}`} />
                <span className={cn("font-medium", h.closed && "text-muted-foreground")}>{WEEKDAYS[d]}</span>
              </label>
              {h.closed ? (
                <span className="text-sm text-muted-foreground">Fechado</span>
              ) : (
                <div className="flex items-center gap-2">
                  <TimeSelect value={h.open_time} onChange={(v) => update(d, { open_time: v })} />
                  <span className="text-sm text-muted-foreground">às</span>
                  <TimeSelect value={h.close_time} onChange={(v) => update(d, { close_time: v })} />
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <Button type="button" variant="outline" className="h-10" onClick={copyMonday} data-testid="btn-copiar-segunda">
        Copiar segunda para terça a sexta
      </Button>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Intervalo entre horários na vitrine</Label>
          <Select value={step} onValueChange={setStep}>
            <SelectTrigger className="h-11" data-testid="select-intervalo"><SelectValue /></SelectTrigger>
            <SelectContent>
              {[10, 15, 20, 30, 60].map((m) => (
                <SelectItem key={m} value={String(m)}>De {m === 60 ? "1 em 1 hora" : `${m} em ${m} minutos`}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Antecedência mínima para agendar online</Label>
          <Select value={notice} onValueChange={setNotice}>
            <SelectTrigger className="h-11" data-testid="select-antecedencia"><SelectValue /></SelectTrigger>
            <SelectContent>
              {NOTICE.map((n) => <SelectItem key={n.v} value={String(n.v)}>{n.l}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      <Button type="submit" className="h-12 w-full text-base sm:w-auto sm:px-8" disabled={pending} data-testid="btn-salvar-horarios">
        {pending ? <Loader2 className="h-5 w-5 animate-spin" /> : "Salvar horários"}
      </Button>
    </form>
  );
}

function TimeSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-10 w-[92px]"><SelectValue /></SelectTrigger>
      <SelectContent className="max-h-64">
        {TIMES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}