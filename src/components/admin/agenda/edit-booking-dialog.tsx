"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { AlertTriangle, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  addBookingItem,
  getBookingEditInfo,
  removeBookingItem,
  setBookingDiscount,
  type BookingEditInfo,
  type DiscountKind,
  type EditConflict,
} from "@/app/admin/(painel)/agenda/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { brl, duration } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Valores do agendamento a partir dos itens (mesma conta do banco: recalc_booking) */
export function bookingTotals(info: BookingEditInfo) {
  const subtotal = info.items.reduce((s, i) => s + i.price, 0);
  const byPackage = info.items.filter((i) => i.paid_by_package).reduce((s, i) => s + i.price, 0);
  return {
    subtotal,
    byPackage,
    discount: info.discount_amount,
    /** valor a cobrar no atendimento (o pacote já foi pago) */
    charge: Math.max(info.price - byPackage, 0),
  };
}

/** Itens agrupados para exibir: cada combo vira uma linha ("Combo Corte + Barba") */
export type ItemGroup = {
  key: string;
  /** id usado para remover (qualquer item do grupo remove o combo inteiro) */
  itemId: string;
  name: string;
  combo: boolean;
  parts: string[];
  price: number;
  duration: number;
  extends_time: boolean;
  paid_by_package: boolean;
  /** tem o item 0: não pode ser removido */
  original: boolean;
};

export function itemGroups(items: BookingEditInfo["items"]): ItemGroup[] {
  const out: ItemGroup[] = [];
  for (const i of items) {
    const g = i.combo_group ? out.find((x) => x.key === i.combo_group) : undefined;
    if (g) {
      g.parts.push(i.name);
      g.price += i.price;
      g.duration += i.duration;
      g.original ||= i.position === 0;
      continue;
    }
    out.push({
      key: i.combo_group ?? i.id,
      itemId: i.id,
      name: i.combo_group ? `Combo ${i.combo_name ?? ""}`.trim() : i.name,
      combo: !!i.combo_group,
      parts: [i.name],
      price: i.price,
      duration: i.duration,
      extends_time: i.extends_time,
      paid_by_package: i.paid_by_package,
      original: i.position === 0,
    });
  }
  return out;
}

const pctText = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 2 });

/** Carrega os dados de edição do agendamento quando `open` */
export function useBookingEditInfo(bookingId: string, open: boolean) {
  const [info, setInfo] = useState<BookingEditInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const r = await getBookingEditInfo(bookingId);
    if (!r) return;
    if (r.ok) {
      setInfo(r.info);
      setError(null);
    } else setError(r.error);
  }, [bookingId]);

  useEffect(() => {
    if (!open) return;
    setInfo(null);
    setError(null);
    reload();
  }, [open, reload]);

  return { info, error, reload };
}

/** Botão "Editar" com o diálogo (ficha do cliente) */
export function EditBookingButton({ bookingId, customerName }: { bookingId: string; customerName: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant="outline" className="h-10" onClick={() => setOpen(true)} data-testid={`btn-editar-${bookingId}`}>
        <Pencil className="mr-1.5 h-4 w-4" /> Editar
      </Button>
      <EditBookingDialog open={open} onOpenChange={setOpen} bookingId={bookingId} customerName={customerName} />
    </>
  );
}

export function EditBookingDialog({
  open,
  onOpenChange,
  bookingId,
  customerName,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  bookingId: string;
  customerName: string;
}) {
  const { info, error, reload } = useBookingEditInfo(bookingId, open);
  const [pending, start] = useTransition();
  const [serviceId, setServiceId] = useState("");
  const [extend, setExtend] = useState(true);
  // 37_plano_fechado: adicional pago por um serviço do pacote da cliente
  const [usePackage, setUsePackage] = useState(false);
  const [conflict, setConflict] = useState<{ kind: EditConflict; message: string } | null>(null);
  const [kind, setKind] = useState<DiscountKind>("valor");
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");

  // abre sempre limpo; o desconto começa com o que já está no agendamento
  useEffect(() => {
    if (!open) return;
    setServiceId("");
    setExtend(true);
    setUsePackage(false);
    setConflict(null);
  }, [open]);
  useEffect(() => {
    if (!info) return;
    setKind(info.discount_kind ?? "valor");
    setValue(info.discount_input ? String(info.discount_input).replace(".", ",") : "");
    setReason(info.discount_reason ?? "");
  }, [info]);

  const canEdit = info?.status === "pending" || info?.status === "confirmed";
  const totals = info ? bookingTotals(info) : null;
  const limit = info?.discount_limit ?? null; // null = sem limite
  const canDiscount = limit === null || limit > 0;
  const selected = info?.services.find((s) => s.id === serviceId);
  // o primeiro pacote (mais antigo) com saldo desse serviço
  const packageOption = info?.package_options?.find((o) => o.service_id === serviceId) ?? null;
  const packageItemId = usePackage && packageOption ? packageOption.id : null;

  function add(withTime: boolean) {
    if (!serviceId) return;
    start(async () => {
      const r = await addBookingItem(bookingId, serviceId, withTime, packageItemId);
      if (!r) return; // demonstração: o servidor redirecionou
      if (!r.ok) {
        if (r.conflict) setConflict({ kind: r.conflict, message: r.error });
        else toast.error(r.error);
        return;
      }
      toast.success(
        packageItemId
          ? "Serviço adicionado pelo pacote"
          : withTime ? "Serviço adicionado" : "Serviço adicionado sem aumentar o tempo"
      );
      setServiceId("");
      setUsePackage(false);
      setConflict(null);
      await reload();
    });
  }

  function remove(itemId: string, name: string) {
    if (!confirm(`Remover ${name} deste agendamento?`)) return;
    start(async () => {
      const r = await removeBookingItem(bookingId, itemId);
      if (!r) return;
      if (!r.ok) return void toast.error(r.error);
      toast.success("Serviço removido");
      await reload();
    });
  }

  function applyDiscount(clear = false) {
    // "1.234,56" ou "10,5" (vírgula decimal) e também "10.5"
    const n = Number(value.includes(",") ? value.replace(/\./g, "").replace(",", ".") : value);
    if (!clear && (!Number.isFinite(n) || n <= 0)) return void toast.error("Informe o valor do desconto.");
    start(async () => {
      const r = await setBookingDiscount(bookingId, clear ? null : kind, clear ? null : n, reason);
      if (!r) return;
      if (!r.ok) return void toast.error(r.error);
      toast.success(clear ? "Desconto removido" : "Desconto aplicado");
      await reload();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92svh] max-w-md overflow-y-auto rounded-2xl">
        <DialogHeader>
          <DialogTitle className="font-heading text-2xl">Editar agendamento</DialogTitle>
          <DialogDescription>
            {customerName}
            {info && ` · ${info.start_time} às ${info.end_time}`}
          </DialogDescription>
        </DialogHeader>

        {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-destructive">{error}</p>}
        {!info && !error && (
          <p className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
          </p>
        )}

        {info && totals && (
          <div className="space-y-5">
            {!canEdit && (
              <p className="rounded-xl bg-secondary p-3 text-sm text-muted-foreground">
                Só dá para editar agendamentos pendentes ou confirmados.
              </p>
            )}

            {/* Serviços */}
            <section className="space-y-2">
              <h3 className="text-sm font-semibold">Serviços</h3>
              <ul className="divide-y rounded-xl border">
                {itemGroups(info.items).map((g, n) => (
                  <li key={g.key} className="flex min-h-[44px] items-center gap-2 px-3 py-2" data-testid={`item-${n}`}>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{g.name}</p>
                      {g.combo && <p className="truncate text-xs text-muted-foreground">{g.parts.join(" + ")}</p>}
                      <p className="text-xs text-muted-foreground">
                        {g.original
                          ? g.combo ? "combo original" : "serviço original"
                          : g.extends_time
                            ? `+ ${duration(g.duration)} no atendimento`
                            : "sem aumentar o tempo"}
                      </p>
                    </div>
                    <span className="shrink-0 text-sm">{g.paid_by_package ? "pacote" : brl(g.price)}</span>
                    {!g.original && canEdit && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-11 w-11 shrink-0 text-muted-foreground hover:text-destructive"
                        disabled={pending}
                        onClick={() => remove(g.itemId, g.name)}
                        aria-label={`Remover ${g.name}`}
                        data-testid={`btn-remover-item-${n}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </section>

            {/* Adicionar serviço */}
            {canEdit && (
              <section className="space-y-3 rounded-xl bg-secondary/60 p-3">
                <h3 className="text-sm font-semibold">Adicionar serviço</h3>
                <Select
                  value={serviceId}
                  onValueChange={(v) => {
                    setServiceId(v);
                    setUsePackage(false);
                    setConflict(null);
                  }}
                >
                  <SelectTrigger className="h-11 bg-white" data-testid="select-servico-adicional">
                    <SelectValue placeholder="Escolha o serviço" />
                  </SelectTrigger>
                  <SelectContent>
                    {info.services.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.kind === "combo" ? "Combo " : ""}
                        {s.name} · {duration(s.duration)} ·{" "}
                        {s.kind === "combo" && (s.normal_price ?? 0) > s.price
                          ? `de ${brl(s.normal_price)} por ${brl(s.price)}`
                          : brl(s.price)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {packageOption && (
                  <label
                    className="flex min-h-[44px] cursor-pointer items-center gap-3 rounded-lg border border-primary/30 bg-white px-3 text-sm"
                    data-testid="opcao-pacote-adicional"
                  >
                    <input
                      type="checkbox"
                      className="h-5 w-5 shrink-0 accent-primary"
                      checked={usePackage}
                      onChange={(e) => setUsePackage(e.target.checked)}
                      data-testid="check-usar-pacote-adicional"
                    />
                    <span>
                      Usar pacote {packageOption.package_name}{" "}
                      <span className="text-muted-foreground">(restam {packageOption.remaining})</span>
                    </span>
                  </label>
                )}
                <label className="flex min-h-[44px] cursor-pointer items-center justify-between gap-3 text-sm">
                  <span>
                    Aumentar o tempo do atendimento
                    {selected && extend && <span className="text-muted-foreground"> (+ {duration(selected.duration)})</span>}
                  </span>
                  <Switch
                    checked={extend}
                    onCheckedChange={(c) => {
                      setExtend(c);
                      setConflict(null);
                    }}
                    data-testid="switch-aumentar-tempo"
                  />
                </label>

                {conflict ? (
                  <div className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm">
                    <p className="flex gap-2">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" /> {conflict.message}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Button className="h-11" disabled={pending} onClick={() => add(false)} data-testid="btn-adicionar-sem-tempo">
                        Adicionar sem aumentar o tempo
                      </Button>
                      <Button variant="ghost" className="h-11" disabled={pending} onClick={() => setConflict(null)}>
                        Voltar
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button
                    className="h-11 w-full"
                    disabled={pending || !serviceId}
                    onClick={() => add(extend)}
                    data-testid="btn-adicionar-servico"
                  >
                    {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="mr-1.5 h-4 w-4" />}
                    Adicionar
                  </Button>
                )}
              </section>
            )}

            {/* Desconto */}
            {canEdit && (
              <section className="space-y-3">
                <h3 className="text-sm font-semibold">
                  Desconto
                  {limit !== null && limit > 0 && (
                    <span className="font-normal text-muted-foreground"> · seu limite: {pctText(limit)}%</span>
                  )}
                </h3>
                {!canDiscount ? (
                  <p className="text-sm text-muted-foreground">
                    Desconto só pela matriz ou pela recepção.
                    {info.discount_amount > 0 && ` Desconto atual: ${brl(info.discount_amount)}.`}
                  </p>
                ) : (
                  <>
                    <div className="flex gap-2">
                      <div className="flex shrink-0 rounded-lg border p-1" role="group" aria-label="Tipo de desconto">
                        {(["valor", "percentual"] as const).map((k) => (
                          <button
                            key={k}
                            type="button"
                            onClick={() => setKind(k)}
                            className={cn(
                              "h-9 min-w-[44px] rounded-md px-3 text-sm font-semibold",
                              kind === k ? "bg-primary text-primary-foreground" : "text-muted-foreground"
                            )}
                            data-testid={`desconto-tipo-${k}`}
                          >
                            {k === "valor" ? "R$" : "%"}
                          </button>
                        ))}
                      </div>
                      <Input
                        inputMode="decimal"
                        placeholder={kind === "valor" ? "0,00" : "0"}
                        value={value}
                        onChange={(e) => setValue(e.target.value.replace(/[^\d,.]/g, ""))}
                        className="h-11"
                        aria-label="Valor do desconto"
                        data-testid="input-desconto"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor={`motivo-${bookingId}`} className="text-xs text-muted-foreground">Motivo (opcional)</Label>
                      <Input
                        id={`motivo-${bookingId}`}
                        maxLength={120}
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        className="h-11"
                        placeholder="Ex.: cliente fiel"
                        data-testid="input-motivo-desconto"
                      />
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button variant="outline" className="h-11" disabled={pending} onClick={() => applyDiscount()} data-testid="btn-aplicar-desconto">
                        Aplicar desconto
                      </Button>
                      {info.discount_kind && (
                        <Button
                          variant="ghost"
                          className="h-11 text-destructive hover:bg-red-50 hover:text-destructive"
                          disabled={pending}
                          onClick={() => applyDiscount(true)}
                          data-testid="btn-remover-desconto"
                        >
                          Remover desconto
                        </Button>
                      )}
                    </div>
                  </>
                )}
              </section>
            )}

            {/* Totais */}
            <dl className="space-y-1 rounded-xl border p-3 text-sm" data-testid="totais-agendamento">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Serviços</dt>
                <dd>{brl(totals.subtotal)}</dd>
              </div>
              {totals.byPackage > 0 && (
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Pago pelo pacote</dt>
                  <dd>− {brl(totals.byPackage)}</dd>
                </div>
              )}
              {totals.discount > 0 && (
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">
                    Desconto{info.discount_kind === "percentual" && info.discount_input ? ` (${pctText(info.discount_input)}%)` : ""}
                  </dt>
                  <dd>− {brl(totals.discount)}</dd>
                </div>
              )}
              <div className="flex justify-between border-t pt-2 text-base font-semibold">
                <dt>{totals.byPackage > 0 ? "A cobrar" : "Total"}</dt>
                <dd>{brl(totals.charge)}</dd>
              </div>
            </dl>

            <Button variant="outline" className="h-11 w-full" onClick={() => onOpenChange(false)} data-testid="btn-fechar-edicao">
              Pronto
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
