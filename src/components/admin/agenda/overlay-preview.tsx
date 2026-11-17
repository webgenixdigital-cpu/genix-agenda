"use client";

// Encaixe sobreposto (50): aviso fixo + quadro "Vai ficar por cima de" antes de salvar.
// Usado no Novo agendamento (serviceId) e no Remarcar (bookingId).
import { useEffect, useState } from "react";
import { AlertTriangle, Layers2, Loader2 } from "lucide-react";
import { checkOverlay, type OverlayCheck } from "@/app/admin/(painel)/agenda/actions";

export function OverlayPreview({
  serviceId,
  bookingId,
  professionalId,
  date,
  time,
  onReady,
}: {
  serviceId?: string | null;
  bookingId?: string | null;
  professionalId: string;
  date: string;
  time: string;
  /** true = pode salvar (o banco confere de novo ao gravar) */
  onReady: (ok: boolean) => void;
}) {
  const [check, setCheck] = useState<OverlayCheck | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const complete = !!professionalId && /^\d{2}:\d{2}$/.test(time) && (!!serviceId || !!bookingId);

  useEffect(() => {
    setCheck(null);
    setError(null);
    onReady(false);
    if (!complete) return;
    let alive = true;
    setLoading(true);
    // espera a pessoa terminar de digitar o horário
    const t = setTimeout(() => {
      checkOverlay({ serviceId, bookingId, professionalId, date, time }).then((r) => {
        if (!alive || !r) return;
        setLoading(false);
        if (r.ok) {
          setCheck(r.check);
          onReady(r.check.issue === null);
        } else setError(r.error);
      });
    }, 300);
    return () => {
      alive = false;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [complete, serviceId, bookingId, professionalId, date, time]);

  return (
    <div className="space-y-2" data-testid="quadro-sobreposto">
      <p className="flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-900">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          O atendimento fica <strong>por cima de outro</strong> do mesmo profissional, no mesmo horário. Use só quando
          der para atender os dois (ex.: enquanto o produto age). A vitrine e o encaixe comum continuam vendo esse
          horário como ocupado.
        </span>
      </p>

      {!complete ? (
        <p className="text-xs text-muted-foreground">Escolha o profissional e o horário para ver com quem vai sobrepor.</p>
      ) : loading && !check && !error ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Conferindo o horário…
        </p>
      ) : error ? (
        <p className="rounded-lg bg-red-50 p-3 text-sm text-destructive">{error}</p>
      ) : check?.issue ? (
        <p className="rounded-lg bg-red-50 p-3 text-sm text-destructive" data-testid="sobreposto-motivo">
          {check.message}
        </p>
      ) : check ? (
        <div className="rounded-lg border border-dashed border-primary/50 bg-secondary/30 p-3 text-sm" data-testid="sobreposto-por-cima">
          <p className="flex items-center gap-1.5 font-semibold">
            <Layers2 className="h-4 w-4 text-primary" /> Vai ficar por cima de:
          </p>
          <ul className="mt-1 space-y-0.5">
            {check.overlaps.map((o) => (
              <li key={o.id} className="break-words">
                <span className="tabular-nums">{o.start}–{o.end}</span> · {o.customer} · {o.service}
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-xs text-muted-foreground">
            Encaixe das {time} às {check.end}.
          </p>
        </div>
      ) : null}
    </div>
  );
}
