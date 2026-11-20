"use client";

import { useMemo, useState, useTransition } from "react";
import { AlertTriangle, ArrowLeftRight, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { changeBookingService, type BookingEditInfo } from "@/app/admin/(painel)/agenda/actions";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { brl, duration } from "@/lib/format";

const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};
const toHHMM = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

/**
 * Prévia da troca do serviço principal (mesma conta do banco: booking_change_service + recalc_booking).
 * Sai o item 0 (ou o combo inteiro dele); os adicionais e o desconto ficam.
 */
export function swapPreview(info: BookingEditInfo, next: { price: number; duration: number }, byPackage: boolean) {
  const g0 = info.items[0]?.combo_group ?? null;
  const isMain = (i: BookingEditInfo["items"][number]) => i.position === 0 || (g0 !== null && i.combo_group === g0);
  const rest = info.items.filter((i) => !isMain(i));
  const dur = rest.filter((i) => i.extends_time).reduce((s, i) => s + i.duration, 0) + next.duration;
  const all = rest.reduce((s, i) => s + i.price, 0) + next.price;
  const base = rest.filter((i) => !i.paid_by_package).reduce((s, i) => s + i.price, 0) + (byPackage ? 0 : next.price);
  const pkg = all - base;
  const disc =
    base <= 0 || !info.discount_kind || !info.discount_input
      ? 0
      : info.discount_kind === "percentual"
        ? Math.round(base * info.discount_input) / 100
        : Math.min(info.discount_input, base);
  const endMin = toMin(info.start_time) + dur;
  return {
    end: endMin >= 24 * 60 ? null : toHHMM(endMin),
    duration: dur,
    /** valor a cobrar no atendimento (o pacote já foi pago) */
    charge: Math.max(Math.max(all - disc, 0) - pkg, 0),
  };
}

/** "Trocar serviço" do item 0 no Editar agendamento (57) */
export function ChangeMainService({
  bookingId,
  info,
  onChanged,
}: {
  bookingId: string;
  info: BookingEditInfo;
  onChanged: () => Promise<void> | void;
}) {
  const [open, setOpen] = useState(false);
  const [serviceId, setServiceId] = useState("");
  const [ack, setAck] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const mainPackage = info.main_package_id ?? null;
  // serviços do MESMO pacote com saldo que o profissional faz (cada serviço: o item mais antigo)
  const packageChoices = useMemo(() => {
    if (!mainPackage) return [];
    const seen = new Set<string>();
    return (info.package_options ?? []).filter((o) => {
      if (o.package_id !== mainPackage || seen.has(o.service_id) || o.service_id === info.main_service_id) return false;
      if (!info.services.some((s) => s.id === o.service_id)) return false;
      seen.add(o.service_id);
      return true;
    });
  }, [info, mainPackage]);
  const packageName =
    (info.package_options ?? []).find((o) => o.package_id === mainPackage)?.package_name ?? null;

  const others = info.services.filter(
    (s) => s.id !== info.main_service_id && !packageChoices.some((o) => o.service_id === s.id)
  );
  const selected = info.services.find((s) => s.id === serviceId);
  const viaPackage = packageChoices.find((o) => o.service_id === serviceId) ?? null;
  const needsUnlink = !!mainPackage && !!selected && !viaPackage;
  const preview = selected ? swapPreview(info, selected, !!viaPackage) : null;

  function reset() {
    setOpen(false);
    setServiceId("");
    setAck(false);
    setError(null);
  }

  function save() {
    if (!selected) return;
    start(async () => {
      const r = await changeBookingService(bookingId, selected.id, viaPackage?.id ?? null, needsUnlink && ack);
      if (!r) return; // demonstração: o servidor redirecionou
      if (!r.ok) return void setError(r.error);
      toast.success(needsUnlink ? "Serviço trocado. A sessão saiu do pacote." : "Serviço trocado");
      reset();
      await onChanged();
    });
  }

  const label = (s: (typeof info.services)[number]) =>
    `${s.kind === "combo" ? "Combo " : ""}${s.name} · ${duration(s.duration)} · ${
      s.kind === "combo" && (s.normal_price ?? 0) > s.price ? `de ${brl(s.normal_price)} por ${brl(s.price)}` : brl(s.price)
    }`;

  if (!open) {
    return (
      <Button
        variant="outline"
        className="h-11 w-full"
        onClick={() => setOpen(true)}
        data-testid="btn-trocar-servico"
      >
        <ArrowLeftRight className="mr-1.5 h-4 w-4" /> Trocar serviço
      </Button>
    );
  }

  return (
    <section className="space-y-3 rounded-xl bg-secondary/60 p-3" data-testid="trocar-servico">
      <h3 className="text-sm font-semibold">Trocar serviço</h3>
      <p className="text-xs text-muted-foreground">
        Troca o serviço principal. O início ({info.start_time}), os adicionais e o desconto continuam.
      </p>
      <Select
        value={serviceId}
        onValueChange={(v) => {
          setServiceId(v);
          setAck(false);
          setError(null);
        }}
      >
        <SelectTrigger className="h-11 bg-white" data-testid="select-trocar-servico">
          <SelectValue placeholder="Escolha o novo serviço" />
        </SelectTrigger>
        <SelectContent className="max-w-[calc(100vw-2rem)]">
          {mainPackage ? (
            <>
              {packageChoices.length > 0 && (
                <SelectGroup>
                  <SelectLabel>Pelo pacote{packageName ? ` · ${packageName}` : ""}</SelectLabel>
                  {packageChoices.map((o) => {
                    const s = info.services.find((x) => x.id === o.service_id)!;
                    return (
                      <SelectItem key={`p-${o.id}`} value={s.id}>
                        {s.name} · {duration(s.duration)} · restam {o.remaining}
                      </SelectItem>
                    );
                  })}
                </SelectGroup>
              )}
              {others.length > 0 && (
                <SelectGroup>
                  <SelectLabel>Cobrado (sai do pacote)</SelectLabel>
                  {others.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {label(s)}
                    </SelectItem>
                  ))}
                </SelectGroup>
              )}
            </>
          ) : (
            others.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {label(s)}
              </SelectItem>
            ))
          )}
        </SelectContent>
      </Select>

      {preview && (
        <p className="rounded-lg bg-white px-3 py-2 text-sm" data-testid="previa-troca">
          {preview.end ? (
            <>
              Termina às <strong>{preview.end}</strong> ({duration(preview.duration)}) ·{" "}
              {viaPackage ? "a cobrar " : ""}
              <strong>{brl(preview.charge)}</strong>
            </>
          ) : (
            "Com esse serviço, o atendimento passaria da meia-noite."
          )}
        </p>
      )}

      {needsUnlink && (
        <div className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm" data-testid="aviso-sai-do-pacote">
          <p className="flex gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <span>
              {selected?.name} não é do pacote{packageName ? ` “${packageName}”` : ""}. A sessão sai do pacote, o saldo
              volta para ele e o atendimento passa a ser cobrado.
            </span>
          </p>
          <label className="flex min-h-[44px] cursor-pointer items-center gap-3">
            <input
              type="checkbox"
              className="h-5 w-5 shrink-0 accent-primary"
              checked={ack}
              onChange={(e) => setAck(e.target.checked)}
              data-testid="check-sair-do-pacote"
            />
            <span>Entendi: sai do pacote e passa a ser cobrado</span>
          </label>
        </div>
      )}

      {error && (
        <p className="flex gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm" role="alert" data-testid="erro-troca">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" /> {error}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          className="h-11 flex-1"
          disabled={pending || !selected || !preview?.end || (needsUnlink && !ack)}
          onClick={save}
          data-testid="btn-confirmar-troca"
        >
          {pending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
          Trocar serviço
        </Button>
        <Button variant="ghost" className="h-11" disabled={pending} onClick={reset} data-testid="btn-cancelar-troca">
          Cancelar
        </Button>
      </div>
    </section>
  );
}
