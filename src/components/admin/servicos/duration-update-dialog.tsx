"use client";

// Depois de mudar a duração de um serviço: pergunta se atualiza os agendamentos FUTUROS
// que já têm esse serviço (avulso, adicional ou em combo). Mostra o término novo e avisa,
// antes de aplicar, quem passaria do início do próximo horário do profissional.
// Os com conflito ficam de fora (o banco também barra pela trava no_overlap).
import { useState, useTransition } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  applyDurationChange,
  type DurationImpact,
  type DurationSkip,
  type DurationSkipReason,
} from "@/app/admin/(painel)/servicos/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { duration } from "@/lib/format";

const hm = (t: string | null) => (t ? t.slice(0, 5) : "—");

// motivos devolvidos por apply_service_duration_change (40)
const SKIP_REASON: Record<DurationSkipReason, string> = {
  CONFLITO: "passaria do início do próximo horário do profissional (conflito).",
  MEIA_NOITE: "passaria da meia-noite.",
  NAO_ENCONTRADO: "não está mais ativo ou já foi alterado.",
  ERRO: "não foi possível atualizar. Tente pela Agenda.",
};

export type DurationChange = {
  serviceId: string;
  serviceName: string;
  from: number;
  to: number;
  items: DurationImpact[];
};

export function DurationUpdateDialog({
  change,
  onClose,
}: {
  change: DurationChange | null;
  onClose: () => void;
}) {
  const [pending, start] = useTransition();
  // depois de aplicar: os que o banco deixou como estavam, com o motivo
  const [skipped, setSkipped] = useState<{ updated: number; list: DurationSkip[] } | null>(null);
  const items = change?.items ?? [];
  const ok = items.filter((i) => !i.conflict);
  const conflicts = items.filter((i) => i.conflict);
  const byId = new Map(items.map((i) => [i.booking_id, i]));

  function close() {
    setSkipped(null);
    onClose();
  }

  function apply() {
    if (!change) return;
    start(async () => {
      const r = await applyDurationChange(change.serviceId, change.to, ok.map((i) => i.booking_id));
      if (!r) return; // demonstração: o servidor redirecionou
      if (!r.ok) return void toast.error(r.error);
      if (r.updated > 0) toast.success(`${r.updated} ${r.updated === 1 ? "agendamento atualizado" : "agendamentos atualizados"}`);
      if (r.skipped.length > 0) setSkipped({ updated: r.updated, list: r.skipped });
      else close();
    });
  }

  return (
    <Dialog open={!!change} onOpenChange={(o) => !o && !pending && close()}>
      <DialogContent className="max-h-[92svh] w-[calc(100%-1.5rem)] max-w-lg overflow-y-auto rounded-2xl" data-testid="dialogo-duracao-futuros">
        {change && skipped && (
          <>
            <DialogHeader>
              <DialogTitle className="font-heading text-2xl">
                {skipped.list.length === 1 ? "1 agendamento não mudou" : `${skipped.list.length} agendamentos não mudaram`}
              </DialogTitle>
              <DialogDescription>
                {skipped.updated > 0
                  ? `${skipped.updated} ${skipped.updated === 1 ? "foi atualizado" : "foram atualizados"}. `
                  : ""}
                Estes continuam com a duração antiga:
              </DialogDescription>
            </DialogHeader>
            <ul className="space-y-1.5 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950" data-testid="lista-duracao-pulados">
              {skipped.list.map((s) => {
                const i = byId.get(s.id);
                return (
                  <li key={s.id} data-testid={`pulado-duracao-${s.id}`}>
                    {i && (
                      <>
                        <span className="font-medium first-letter:uppercase">
                          {format(parseISO(i.booking_date), "EEE dd/MM", { locale: ptBR })} {hm(i.start_time)}
                        </span>{" "}
                        · {i.customer_name}:{" "}
                      </>
                    )}
                    {SKIP_REASON[s.reason] ?? SKIP_REASON.ERRO}
                  </li>
                );
              })}
            </ul>
            <DialogFooter>
              <Button className="h-11" onClick={close} data-testid="btn-duracao-fechar">
                Entendi
              </Button>
            </DialogFooter>
          </>
        )}
        {change && !skipped && (
          <>
            <DialogHeader>
              <DialogTitle className="font-heading text-2xl">Atualizar os agendamentos futuros?</DialogTitle>
              <DialogDescription>
                {change.serviceName} passou de {duration(change.from)} para {duration(change.to)}.{" "}
                {items.length === 1 ? "1 agendamento futuro tem" : `${items.length} agendamentos futuros têm`} esse serviço.
                O início não muda; o término é recalculado com todos os serviços do horário.
              </DialogDescription>
            </DialogHeader>

            {conflicts.length > 0 && (
              <div className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950" data-testid="aviso-conflitos-duracao">
                <p className="flex items-center gap-1.5 font-semibold">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  {conflicts.length === 1 ? "1 fica como está" : `${conflicts.length} ficam como estão`} (conflito)
                </p>
                <ul className="space-y-1.5">
                  {conflicts.map((i) => (
                    <li key={i.booking_id} data-testid={`conflito-duracao-${i.booking_id}`}>
                      <span className="font-medium first-letter:uppercase">
                        {format(parseISO(i.booking_date), "EEE dd/MM", { locale: ptBR })} {hm(i.start_time)}
                      </span>{" "}
                      · {i.customer_name} com {i.professional_name}:{" "}
                      {i.conflict === "meia_noite"
                        ? "passaria da meia-noite."
                        : `terminaria às ${hm(i.new_end)}, depois do próximo horário (${hm(i.next_start)}${i.next_customer ? `, ${i.next_customer}` : ""}).`}
                    </li>
                  ))}
                </ul>
                <p className="text-xs">Para esses, remarque ou ajuste na Agenda.</p>
              </div>
            )}

            {ok.length > 0 && (
              <ul className="divide-y rounded-xl border text-sm" data-testid="lista-duracao-futuros">
                {ok.map((i) => (
                  <li key={i.booking_id} className="flex flex-wrap justify-between gap-x-3 gap-y-0.5 p-2.5">
                    <span className="min-w-0">
                      <span className="font-medium first-letter:uppercase">
                        {format(parseISO(i.booking_date), "EEE dd/MM", { locale: ptBR })} {hm(i.start_time)}
                      </span>{" "}
                      · {i.customer_name}
                    </span>
                    <span className="shrink-0 text-muted-foreground">
                      até {hm(i.old_end)} → <strong className="text-foreground">{hm(i.new_end)}</strong>
                    </span>
                  </li>
                ))}
              </ul>
            )}

            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="outline" className="h-11" disabled={pending} onClick={close} data-testid="btn-duracao-agora-nao">
                {ok.length > 0 ? "Agora não" : "Fechar"}
              </Button>
              {ok.length > 0 && (
                <Button className="h-11" disabled={pending} onClick={apply} data-testid="btn-duracao-atualizar">
                  {pending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                  Atualizar {ok.length === 1 ? "1 agendamento" : `${ok.length} agendamentos`}
                </Button>
              )}
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
