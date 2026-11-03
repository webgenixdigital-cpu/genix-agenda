"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { addDays, format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { saveView, type AgendaView } from "@/components/admin/agenda/view-preference";
import { addMonths, monthTitle } from "@/lib/agenda";
import { cn } from "@/lib/utils";

type Props = {
  view: AgendaView;
  /** Dia: yyyy-mm-dd · Semana: a segunda-feira · Mês: yyyy-mm */
  date: string;
  today: string;
  status: string;
  professionalId: string;
  pendingMode: boolean;
  professionals: { id: string; name: string }[];
  /** Semana e Mês: chave "Mostrar cancelados" */
  showCancelled?: boolean;
};

const VIEW_LABEL: Record<AgendaView, string> = { dia: "Dia", semana: "Semana", mes: "Mês" };

/** Troca parâmetros da URL da Agenda (null = remove) */
export function useAgendaNav() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  return (patch: Record<string, string | null>, replace = false) => {
    const p = new URLSearchParams(params.toString());
    Object.entries(patch).forEach(([k, v]) => (v ? p.set(k, v) : p.delete(k)));
    const url = `${pathname}?${p.toString()}`;
    if (replace) router.replace(url);
    else router.push(url);
  };
}

export function ProfessionalFilter({
  value,
  professionals,
  onChange,
  className,
}: {
  value: string;
  professionals: { id: string; name: string }[];
  onChange: (v: string | null) => void;
  className?: string;
}) {
  if (professionals.length <= 1) return null;
  return (
    <Select value={value} onValueChange={(v) => onChange(v === "all" ? null : v)}>
      <SelectTrigger className={cn("h-11 md:w-48", className)} data-testid="filtro-profissional">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">Todos os profissionais</SelectItem>
        {professionals.map((p) => (
          <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function CancelledToggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
      <Switch checked={checked} onCheckedChange={onChange} data-testid="toggle-mostrar-cancelados" />
      Mostrar cancelados
    </label>
  );
}


export function AgendaToolbar({ view, date, today, status, professionalId, pendingMode, professionals, showCancelled = false }: Props) {
  const go = useAgendaNav();
  const [calOpen, setCalOpen] = useState(false);

  const shift = (n: number) => go({ data: format(addDays(parseISO(date), n), "yyyy-MM-dd") });

  function switchView(v: AgendaView) {
    saveView(v);
    // data: o Mês usa yyyy-mm; ao sair dele, o 1º dia do mês (ou hoje, se for o mês atual)
    let data: string | null = date;
    if (v === "mes") data = date.slice(0, 7);
    else if (view === "mes") data = date === today.slice(0, 7) ? null : `${date}-01`;
    // ao trocar de visão, o filtro de status (só do Dia) e o de cancelados (Semana/Mês) saem
    go({ visao: v, data, status: null, cancelados: null });
  }

  const viewSwitch = (
    <div className="hidden rounded-lg border bg-card p-1 md:flex" role="tablist" aria-label="Visão da agenda">
      {(["dia", "semana", "mes"] as const).map((v) => (
        <button
          key={v}
          role="tab"
          aria-selected={view === v}
          onClick={() => view !== v && switchView(v)}
          className={cn(
            "h-11 min-w-20 rounded-md px-4 text-sm font-semibold transition-colors",
            view === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
          )}
          data-testid={`btn-visao-${v}`}
        >
          {VIEW_LABEL[v]}
        </button>
      ))}
    </div>
  );

  const proFilter = (
    <ProfessionalFilter value={professionalId} professionals={professionals} onChange={(v) => go({ prof: v })} />
  );
  const cancelledToggle = (
    <CancelledToggle checked={showCancelled} onChange={(v) => go({ cancelados: v ? "1" : null })} />
  );

  if (view === "mes") {
    const thisMonth = date === today.slice(0, 7);
    return (
      <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-center md:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          {viewSwitch}
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" className="h-11 w-11" onClick={() => go({ data: addMonths(date, -1) })} aria-label="Mês anterior" data-testid="btn-mes-anterior">
              <ChevronLeft className="h-5 w-5" />
            </Button>
            <span className="min-w-[170px] px-2 text-center text-sm font-semibold first-letter:uppercase" data-testid="titulo-mes">
              {monthTitle(date)}
            </span>
            <Button variant="outline" size="icon" className="h-11 w-11" onClick={() => go({ data: addMonths(date, 1) })} aria-label="Próximo mês" data-testid="btn-mes-proximo">
              <ChevronRight className="h-5 w-5" />
            </Button>
            <Button variant="ghost" className="h-11" disabled={thisMonth} onClick={() => go({ data: null })} data-testid="btn-mes-hoje">
              Hoje
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {cancelledToggle}
          {proFilter}
        </div>
      </div>
    );
  }

  if (view === "semana") {
    const end = addDays(parseISO(date), 6);
    const thisWeek = today >= date && today <= format(end, "yyyy-MM-dd");
    return (
      <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-center md:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          {viewSwitch}
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" className="h-11 w-11" onClick={() => shift(-7)} aria-label="Semana anterior" data-testid="btn-semana-anterior">
              <ChevronLeft className="h-5 w-5" />
            </Button>
            <span className="min-w-[150px] px-2 text-center text-sm font-semibold" data-testid="titulo-semana">
              {format(parseISO(date), "dd/MM")} – {format(end, "dd/MM/yyyy")}
            </span>
            <Button variant="outline" size="icon" className="h-11 w-11" onClick={() => shift(7)} aria-label="Próxima semana" data-testid="btn-semana-proxima">
              <ChevronRight className="h-5 w-5" />
            </Button>
            <Button variant="ghost" className="h-11" disabled={thisWeek} onClick={() => go({ data: null })} data-testid="btn-semana-hoje">
              Hoje
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {cancelledToggle}
          {proFilter}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
      {/* Navegação por dia */}
      <div className="flex items-center gap-1">
        <span className="mr-2">{viewSwitch}</span>
        <Button variant="outline" size="icon" className="h-11 w-11" onClick={() => shift(-1)} disabled={pendingMode} aria-label="Dia anterior" data-testid="btn-dia-anterior">
          <ChevronLeft className="h-5 w-5" />
        </Button>

        <Popover open={calOpen} onOpenChange={setCalOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" className="h-11 min-w-[190px] justify-start gap-2 capitalize" disabled={pendingMode} data-testid="btn-escolher-data">
              <CalendarDays className="h-4 w-4 text-primary" />
              {format(parseISO(date), "EEE, dd 'de' MMM", { locale: ptBR })}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="single"
              locale={ptBR}
              selected={parseISO(date)}
              onSelect={(d) => {
                if (!d) return;
                setCalOpen(false);
                go({ data: format(d, "yyyy-MM-dd") });
              }}
            />
          </PopoverContent>
        </Popover>

        <Button variant="outline" size="icon" className="h-11 w-11" onClick={() => shift(1)} disabled={pendingMode} aria-label="Próximo dia" data-testid="btn-dia-seguinte">
          <ChevronRight className="h-5 w-5" />
        </Button>

        {date !== today && !pendingMode && (
          <Button variant="ghost" className="h-11" onClick={() => go({ data: null })} data-testid="btn-hoje">
            Hoje
          </Button>
        )}
      </div>

      {/* Filtros */}
      <div className="grid grid-cols-2 gap-2 md:flex">
        <Select value={status} onValueChange={(v) => go({ status: v === "all" ? null : v })}>
          <SelectTrigger className="h-11 md:w-44" data-testid="filtro-status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os status</SelectItem>
            <SelectItem value="pending">Pendentes</SelectItem>
            <SelectItem value="confirmed">Confirmados</SelectItem>
            <SelectItem value="completed">Concluídos</SelectItem>
            <SelectItem value="cancelled">Cancelados</SelectItem>
          </SelectContent>
        </Select>

        {proFilter}
      </div>
    </div>
  );
}
