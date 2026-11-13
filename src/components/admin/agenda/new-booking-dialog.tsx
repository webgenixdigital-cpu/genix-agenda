"use client";

import { useEffect, useState, useTransition } from "react";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { CalendarDays, Check, Loader2, Lock, Package, Plus, Repeat, X } from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";
import {
  createManualBooking,
  createSeries,
  findCustomerPackages,
  previewSeries,
  type PackageOption,
  type SeriesDate,
  type SeriesFrequency,
  type SeriesInput,
} from "@/app/admin/(painel)/agenda/actions";
import { startPackageSale } from "@/app/admin/(painel)/clientes/actions";
import { SellPackageDialog } from "@/components/admin/clientes/packages-card";
import type { SaleProfessional, SaleTemplate } from "@/lib/package-sale";
import { FREQUENCY_LABEL, SKIP_REASON } from "@/lib/series";
import { CustomerSearch } from "@/components/admin/agenda/customer-search";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { brl, duration } from "@/lib/format";
import { BR, cleanCountry, displayPhone, isPhoneShapeValid, normalizePhone, phoneError } from "@/lib/phone";
import { PhoneInput } from "@/components/phone-input-lazy";

type Props = {
  defaultDate: string;
  services: { id: string; name: string; price: number; duration_min: number; kind?: string | null }[];
  professionals: { id: string; name: string }[];
  /** plano pago (Profissional ou Equipe): libera "Repetir" (agendamentos recorrentes) */
  fullAccess?: boolean;
  /** matriz e recepção: botão "Vender pacote" (no Grátis aparece com cadeado) */
  canSellPackages?: boolean;
  /** modo controlado (grade semanal): abre por fora, sem o botão próprio */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** pré-preenchimento ao abrir (clique num horário vazio da grade) */
  initial?: { date: string; time: string; professionalId?: string | null };
};

type Preview = { dates: SeriesDate[]; packageFit: number | null; packageExpires: string | null };

const shortDate = (iso: string) => format(parseISO(iso), "EEE, dd/MM/yyyy", { locale: ptBR });

// 06:00 até 22:00, de 15 em 15 minutos
const TIMES = Array.from({ length: 65 }, (_, i) => {
  const m = 6 * 60 + i * 15;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
});

export function NewBookingDialog({
  defaultDate,
  services,
  professionals,
  fullAccess = false,
  canSellPackages = false,
  open: openProp,
  onOpenChange,
  initial,
}: Props) {
  const controlled = openProp !== undefined;
  const [innerOpen, setInnerOpen] = useState(false);
  const open = controlled ? openProp : innerOpen;
  const setOpen = (v: boolean) => (controlled ? onOpenChange?.(v) : setInnerOpen(v));
  const [calOpen, setCalOpen] = useState(false);
  const [pending, start] = useTransition();

  const [serviceId, setServiceId] = useState("");
  const [professionalId, setProfessionalId] = useState(professionals.length === 1 ? professionals[0].id : "");
  const [date, setDate] = useState(defaultDate);
  const [time, setTime] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [phoneCountry, setPhoneCountry] = useState(BR);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [packages, setPackages] = useState<PackageOption[]>([]);
  const [packageId, setPackageId] = useState<string | null>(null);

  // cliente com pacote ativo deste serviço? (busca pelo WhatsApp digitado)
  const phoneNational = normalizePhone(phone, phoneCountry);
  // regra do banco (a validação completa, com libphonenumber, fica no servidor)
  const phoneOk = isPhoneShapeValid(phoneCountry, phoneNational);
  // chave do número (país + número) para refazer buscas quando muda
  const phoneKey = phoneOk ? `${phoneCountry}:${phoneNational}` : "";
  useEffect(() => {
    setPackageId(null);
    if (!open || !serviceId || !phoneKey) {
      setPackages([]);
      return;
    }
    let alive = true;
    const [c, p] = phoneKey.split(":");
    findCustomerPackages(p, serviceId, c).then((list) => {
      if (alive) setPackages(list ?? []);
    });
    return () => {
      alive = false;
    };
  }, [open, serviceId, phoneKey]);

  // "Vender pacote": acha/cadastra o cliente pelo WhatsApp e abre o diálogo da ficha
  const [sale, setSale] = useState<{ customerId: string; templates: SaleTemplate[]; professionals: SaleProfessional[] } | null>(null);
  const [saleOpen, setSaleOpen] = useState(false);
  const [saleLoading, startSale] = useTransition();

  function openSale() {
    startSale(async () => {
      const r = await startPackageSale({ name, phone, phoneCountry });
      if (!r) return; // demonstração: o servidor redirecionou
      if (!r.ok) return void toast.error(r.error);
      setSale({ customerId: r.customerId, templates: r.templates, professionals: r.professionals });
      setSaleOpen(true);
    });
  }

  // vendeu: recarrega os pacotes deste serviço e já marca o novo para este horário
  async function afterSale() {
    const before = new Set(packages.map((p) => p.id));
    const list = (await findCustomerPackages(phoneNational, serviceId, phoneCountry)) ?? [];
    setPackages(list);
    const fresh = list.find((p) => !before.has(p.id));
    if (fresh) setPackageId(fresh.id);
    else if (list.length === 0) toast.info("O pacote vendido não inclui este serviço.");
  }

  // recorrência: qualquer mudança nos dados invalida a prévia
  const [repeat, setRepeat] = useState(false);
  const [frequency, setFrequency] = useState<SeriesFrequency>("weekly");
  const [count, setCount] = useState("4");
  const [preview, setPreview] = useState<Preview | null>(null);
  useEffect(() => {
    setPreview(null);
  }, [serviceId, professionalId, date, time, phoneKey, packageId, repeat, frequency, count]);

  const n = Math.min(Math.max(Number(count) || 0, 0), 52);
  const okDates = preview?.dates.filter((d) => !d.issue) ?? [];
  const packageShort = preview && packageId && preview.packageFit !== null && preview.packageFit < n ? preview.packageFit : null;

  function fill(init?: Props["initial"]) {
    setDate(init?.date ?? defaultDate);
    setTime(init?.time ?? "");
    if (init?.professionalId) setProfessionalId(init.professionalId);
    setName("");
    setPhone("");
    setPhoneCountry(BR);
    setNotes("");
    setError(null);
    setRepeat(false);
    setPreview(null);
  }

  function openDialog() {
    fill();
    setOpen(true);
  }

  // modo controlado: preenche a cada abertura
  useEffect(() => {
    if (controlled && openProp) fill(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controlled, openProp, initial]);

  // horário vindo da grade fora da lista de 15 em 15 (ex.: passo de 10 min)
  const times = !time || TIMES.includes(time) ? TIMES : [...TIMES, time].sort();

  function seriesInput(): SeriesInput {
    return {
      serviceId, professionalId, date, time, frequency, count: n,
      customerName: name, customerPhone: phone, customerPhoneCountry: phoneCountry, notes, packageId,
    };
  }

  function submitSeries() {
    if (n < 1) return setError("Escolha de 1 a 52 vezes.");
    if (name.trim().length < 2) return setError("Informe o nome do cliente.");
    if (!phoneOk) return setError(phoneError(phoneCountry));
    start(async () => {
      // 1º toque: prévia das datas
      if (!preview) {
        const r = await previewSeries(seriesInput());
        if (!r) return;
        if (r.ok) setPreview({ dates: r.dates, packageFit: r.packageFit, packageExpires: r.packageExpires });
        else setError(r.error);
        return;
      }
      // 2º toque: cria as datas livres e pula as recusadas
      const r = await createSeries(seriesInput());
      if (!r) return; // demonstração: o servidor redirecionou
      if (!r.ok) return setError(r.error);
      const msg = `${r.created} ${r.created === 1 ? "criado" : "criados"}, ${r.skipped.length} ${r.skipped.length === 1 ? "pulado" : "pulados"}`;
      if (r.skipped.length > 0) {
        toast.warning(msg, {
          description: r.skipped.map((s) => `${shortDate(s.date)}: ${SKIP_REASON[s.issue ?? ""] ?? s.issue}`).join("\n"),
          duration: 10000,
        });
      } else toast.success(msg);
      if (r.created > 0) setOpen(false);
      else setPreview(null);
    });
  }

  function submit() {
    setError(null);
    if (repeat) return submitSeries();
    start(async () => {
      const r = await createManualBooking({
        serviceId, professionalId, date, time, customerName: name, customerPhone: phone,
        customerPhoneCountry: phoneCountry, notes, packageId,
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
      {!controlled && (
        <Button className="h-11" onClick={openDialog} data-testid="btn-novo-agendamento">
          <Plus className="mr-1.5 h-4 w-4" /> Novo agendamento
        </Button>
      )}

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
                      {s.kind === "combo" ? "Combo " : ""}{s.name} · {duration(s.duration_min)} · {brl(s.price)}
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
                    {times.map((t) => (
                      <SelectItem key={t} value={t}>{t}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="nb-name">Nome do cliente</Label>
                <CustomerSearch
                  id="nb-name"
                  value={name}
                  onChange={setName}
                  // escolher preenche nome + WhatsApp; a busca de pacote dispara pelo efeito do WhatsApp
                  onPick={(c) => {
                    setName(c.name);
                    setPhoneCountry(cleanCountry(c.phoneCountry));
                    setPhone(displayPhone(c.phone, cleanCountry(c.phoneCountry)));
                  }}
                  onDigitsOnly={(digits) => {
                    setPhone(displayPhone(normalizePhone(digits, phoneCountry), phoneCountry));
                    setName("");
                  }}
                  onClear={() => {
                    setName("");
                    setPhone("");
                  }}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="nb-phone">WhatsApp</Label>
                <PhoneInput
                  id="nb-phone"
                  value={phone}
                  country={phoneCountry}
                  onChange={(v, c) => {
                    setPhone(v);
                    setPhoneCountry(c);
                  }}
                  testId="input-whatsapp-manual"
                />
              </div>
            </div>

            {packages.length > 0 && (
              <div className="space-y-2 rounded-xl border border-primary/30 bg-secondary/40 p-3" data-testid="opcoes-pacote-manual">
                <p className="text-sm font-semibold">Este cliente tem pacote deste serviço</p>
                {packages.map((p) => {
                  const expired = !!p.expires_at && p.expires_at < date;
                  return (
                    <label
                      key={p.id}
                      className={cn("flex min-h-11 cursor-pointer items-center gap-3 text-sm", expired && "cursor-not-allowed opacity-60")}
                    >
                      <input
                        type="checkbox"
                        className="h-5 w-5 accent-primary"
                        disabled={expired}
                        checked={packageId === p.id}
                        onChange={(e) => setPackageId(e.target.checked ? p.id : null)}
                        data-testid={`check-usar-pacote-${p.id}`}
                      />
                      <span>
                        Usar pacote {p.name} (restam {p.remaining})
                        {p.expires_at && (
                          <span className="text-muted-foreground">
                            {" · "}
                            {expired ? "vence antes desta data" : `vale até ${p.expires_at.split("-").reverse().join("/")}`}
                          </span>
                        )}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}

            {/* vender pacote sem sair da Agenda (mesmo diálogo da ficha do cliente) */}
            {canSellPackages && serviceId && phoneOk && (
              fullAccess ? (
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 w-full"
                  disabled={saleLoading}
                  onClick={openSale}
                  data-testid="btn-vender-pacote-agenda"
                >
                  {saleLoading ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Package className="mr-1.5 h-4 w-4" />}
                  Vender pacote
                </Button>
              ) : (
                <Button asChild variant="outline" className="h-11 w-full" data-testid="btn-liberar-pacotes-agenda">
                  <Link href="/admin/assinatura">
                    <Lock className="mr-1.5 h-4 w-4" /> Vender pacote · planos pagos
                  </Link>
                </Button>
              )
            )}

            <div className="space-y-1.5">
              <Label htmlFor="nb-notes">Observações (opcional)</Label>
              <Textarea id="nb-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value.slice(0, 500))} />
            </div>

            {/* Repetir (recorrência) — recurso dos planos pagos */}
            {fullAccess ? (
              <div className="space-y-3 rounded-xl border p-3">
                <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm font-semibold">
                  <input
                    type="checkbox"
                    className="h-5 w-5 accent-primary"
                    checked={repeat}
                    onChange={(e) => setRepeat(e.target.checked)}
                    data-testid="check-repetir"
                  />
                  <Repeat className="h-4 w-4 text-primary" /> Repetir este horário
                </label>

                {repeat && (
                  <div className="grid grid-cols-[1fr_auto] items-end gap-3">
                    <div className="space-y-1.5">
                      <Label>Frequência</Label>
                      <Select value={frequency} onValueChange={(v) => setFrequency(v as SeriesFrequency)}>
                        <SelectTrigger className="h-11" data-testid="select-frequencia"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {(Object.keys(FREQUENCY_LABEL) as SeriesFrequency[]).map((f) => (
                            <SelectItem key={f} value={f}>{FREQUENCY_LABEL[f]}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="nb-count">Vezes</Label>
                      <Input
                        id="nb-count"
                        className="h-11 w-20"
                        inputMode="numeric"
                        value={count}
                        onChange={(e) => setCount(e.target.value.replace(/\D/g, "").slice(0, 2))}
                        data-testid="input-vezes"
                      />
                    </div>
                    {frequency === "monthly" && Number(date.slice(8)) >= 29 && (
                      <p className="col-span-2 text-xs text-muted-foreground">
                        Nos meses sem esse dia, o horário cai no último dia do mês.
                      </p>
                    )}
                  </div>
                )}

                {repeat && preview && (
                  <div className="space-y-2" data-testid="previa-recorrencia">
                    {packageShort !== null && (
                      <div className="flex flex-wrap items-center gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
                        <span>
                          Só cabem {packageShort} {packageShort === 1 ? "sessão" : "sessões"} no pacote
                          {preview.packageExpires ? ` até ${preview.packageExpires.split("-").reverse().join("/")}` : ""}.
                        </span>
                        {packageShort > 0 && (
                          <Button type="button" size="sm" variant="outline" className="h-10" onClick={() => setCount(String(packageShort))} data-testid="btn-ajustar-vezes">
                            Usar {packageShort}
                          </Button>
                        )}
                      </div>
                    )}
                    <ul className="max-h-56 space-y-1 overflow-y-auto rounded-lg bg-secondary/40 p-2 text-sm">
                      {preview.dates.map((d) => (
                        <li key={d.seq} className="flex items-center gap-2" data-testid={`previa-data-${d.seq}`}>
                          {d.issue ? <X className="h-4 w-4 shrink-0 text-destructive" /> : <Check className="h-4 w-4 shrink-0 text-green-700" />}
                          <span className={cn(d.issue && "text-muted-foreground line-through")}>{shortDate(d.date)} às {time}</span>
                          {d.issue && <span className="text-xs text-destructive">{SKIP_REASON[d.issue] ?? d.issue}</span>}
                        </li>
                      ))}
                    </ul>
                    <p className="text-xs text-muted-foreground">
                      Datas com ✕ serão puladas (sem data extra no fim).
                      {packageId ? " Sessão pulada não usa o saldo do pacote." : ""}
                    </p>
                  </div>
                )}
              </div>
            ) : (
              <Link
                href="/admin/assinatura"
                className="flex min-h-11 items-center gap-2 rounded-xl border border-dashed p-3 text-sm text-muted-foreground hover:text-foreground"
                data-testid="link-repetir-bloqueado"
              >
                <Lock className="h-4 w-4 text-primary" /> Repetir este horário · planos Profissional e Equipe
              </Link>
            )}

            {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-destructive">{error}</p>}

            <Button
              type="submit"
              className="h-12 w-full text-base"
              disabled={
                pending || !serviceId || !professionalId || !time ||
                (repeat && !!preview && (okDates.length === 0 || packageShort !== null))
              }
              data-testid="btn-salvar-agendamento-manual"
            >
              {pending ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : !repeat ? (
                "Salvar agendamento"
              ) : !preview ? (
                "Ver datas"
              ) : (
                `Criar ${okDates.length} ${okDates.length === 1 ? "agendamento" : "agendamentos"}`
              )}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      {sale && (
        <SellPackageDialog
          open={saleOpen}
          onOpenChange={setSaleOpen}
          customerId={sale.customerId}
          templates={sale.templates}
          professionals={sale.professionals}
          onSold={afterSale}
        />
      )}
    </>
  );
}
