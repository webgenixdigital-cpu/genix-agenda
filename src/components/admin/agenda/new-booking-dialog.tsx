"use client";

import { Ajuda } from "@/components/ajuda";
import { useEffect, useRef, useState, useTransition } from "react";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { CalendarDays, Check, Loader2, Lock, Package, Plus, Repeat, UserRound, X } from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";
import {
  createManualBooking,
  createSeries,
  listManualSlots,
  lookupCustomer,
  previewSeries,
  type CustomerPackage,
  type ManualSlot,
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
  /** profissionais que quem está logado pode agendar (profissional: só ele mesmo) */
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
/** cliente achado pelo WhatsApp: null = ainda não procurou; found false = cliente novo */
type Lookup = { found: boolean; packages: CustomerPackage[] } | null;

const shortDate = (iso: string) => format(parseISO(iso), "EEE, dd/MM/yyyy", { locale: ptBR });
const br = (iso: string) => iso.split("-").reverse().join("/");

// encaixe: 06:00 até 22:00, de 15 em 15 minutos (a lista de sempre do agendamento manual)
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
  const [error, setError] = useState<string | null>(null);

  // ------------------------------------------------------------------ 1. cliente
  const [phone, setPhone] = useState("");
  const [phoneCountry, setPhoneCountry] = useState(BR);
  const [name, setName] = useState("");
  const [lookup, setLookup] = useState<Lookup>(null);
  const [lookingUp, setLookingUp] = useState(false);

  const phoneNational = normalizePhone(phone, phoneCountry);
  // regra do banco (a validação completa, com libphonenumber, fica no servidor)
  const phoneOk = isPhoneShapeValid(phoneCountry, phoneNational);
  // chave do número (país + número) para refazer buscas quando muda
  const phoneKey = phoneOk ? `${phoneCountry}:${phoneNational}` : "";

  // WhatsApp completo: procura o cliente; achou = preenche o nome e traz os pacotes
  useEffect(() => {
    setLookup(null);
    if (!open || !phoneKey) return;
    let alive = true;
    const [c, p] = phoneKey.split(":");
    setLookingUp(true);
    lookupCustomer(p, c).then((r) => {
      if (!alive) return;
      setLookingUp(false);
      if (r) {
        setName(r.name);
        setLookup({ found: true, packages: r.packages });
      } else setLookup({ found: false, packages: [] });
    });
    return () => {
      alive = false;
    };
  }, [open, phoneKey]);

  const packages = lookup?.packages ?? [];

  // ------------------------------------------------------------------ 2. pacote
  const [packageId, setPackageId] = useState<string | null>(null);
  /** pacote com vários serviços: mostra a escolha do serviço */
  const [packageChoosing, setPackageChoosing] = useState<string | null>(null);
  const pkg = packages.find((p) => p.id === packageId) ?? null;

  // trocou de cliente: pacote de outra pessoa sai
  useEffect(() => {
    if (packageId && lookup && !lookup.packages.some((p) => p.id === packageId)) setPackageId(null);
    if (packageChoosing && lookup && !lookup.packages.some((p) => p.id === packageChoosing)) setPackageChoosing(null);
  }, [lookup, packageId, packageChoosing]);

  function applyPackage(p: CustomerPackage, serviceIdToUse?: string) {
    const item = serviceIdToUse
      ? p.items.find((i) => i.serviceId === serviceIdToUse)
      : p.items.length === 1
        ? p.items[0]
        : p.items.find((i) => i.serviceId === serviceId);
    if (!item) {
      setPackageChoosing(p.id); // vários serviços: a pessoa escolhe qual
      return;
    }
    setPackageChoosing(null);
    setPackageId(p.id);
    if (item.serviceId !== serviceId) changeService(item.serviceId, p);
  }

  // "Vender pacote": acha/cadastra o cliente pelo WhatsApp e abre o diálogo da ficha
  const [sale, setSale] = useState<{ customerId: string; templates: SaleTemplate[]; professionals: SaleProfessional[] } | null>(null);
  const [saleOpen, setSaleOpen] = useState(false);
  const [saleLoading, startSale] = useTransition();

  function openSale() {
    if (name.trim().length < 2) return void toast.error("Informe o nome do cliente para vender o pacote.");
    startSale(async () => {
      const r = await startPackageSale({ name, phone, phoneCountry });
      if (!r) return; // demonstração: o servidor redirecionou
      if (!r.ok) return void toast.error(r.error);
      setSale({ customerId: r.customerId, templates: r.templates, professionals: r.professionals });
      setSaleOpen(true);
    });
  }

  // vendeu: recarrega os pacotes e já marca o novo (pacote com datas fixas já nasce com as visitas)
  async function afterSale() {
    const before = new Set(packages.map((p) => p.id));
    const r = await lookupCustomer(phoneNational, phoneCountry);
    const list = r?.packages ?? [];
    setLookup({ found: true, packages: list });
    const fresh = list.find((p) => !before.has(p.id));
    if (fresh) applyPackage(fresh);
    else toast.info("Pacote vendido. As sessões com data já estão na agenda.");
  }

  // ------------------------------------------------------------------ 3. serviço
  const [serviceId, setServiceId] = useState("");

  function changeService(id: string, keepPackage: CustomerPackage | null = pkg) {
    setServiceId(id);
    if (keepPackage && !keepPackage.items.some((i) => i.serviceId === id)) {
      setPackageId(null);
      toast.info("O pacote escolhido não inclui este serviço; ficou sem pacote.");
    }
  }

  // ------------------------------------------------------------------ 4. data e horário
  const [date, setDate] = useState(defaultDate);
  const [time, setTime] = useState("");
  const [slots, setSlots] = useState<ManualSlot[] | null>(null);
  const [slotsError, setSlotsError] = useState<string | null>(null);
  // encaixe: horário fora da lista (sem expediente; bloqueio e ocupado continuam valendo)
  const [fit, setFit] = useState(false);
  const [fitTime, setFitTime] = useState("");
  const [fitSlot, setFitSlot] = useState<ManualSlot | null | undefined>(undefined); // undefined = carregando
  // clique na grade semanal: aplica horário e profissional quando os horários chegam
  const pendingInitial = useRef<Props["initial"] | null>(null);

  useEffect(() => {
    setSlots(null);
    setSlotsError(null);
    if (!open || !serviceId) return;
    let alive = true;
    listManualSlots(serviceId, date).then((r) => {
      if (!alive || !r) return;
      if (r.ok) setSlots(r.slots);
      else setSlotsError(r.error);
    });
    return () => {
      alive = false;
    };
  }, [open, serviceId, date]);

  useEffect(() => {
    setFitSlot(undefined);
    if (!open || !fit || !serviceId || !fitTime) return;
    let alive = true;
    listManualSlots(serviceId, date, fitTime).then((r) => {
      if (!alive || !r) return;
      setFitSlot(r.ok ? (r.slots[0] ?? null) : null);
    });
    return () => {
      alive = false;
    };
  }, [open, fit, serviceId, date, fitTime]);

  // horários chegaram: aplica o clique da grade; senão, tira o horário que deixou de valer
  useEffect(() => {
    if (!slots) return;
    const init = pendingInitial.current;
    if (init?.time) {
      pendingInitial.current = init.professionalId ? { ...init, time: "" } : null;
      if (slots.some((s) => s.time === init.time)) {
        setFit(false);
        setTime(init.time);
      } else {
        setFit(true);
        setFitTime(init.time);
      }
      return;
    }
    if (!fit && time && !slots.some((s) => s.time === time)) setTime("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slots]);

  const chosenTime = fit ? fitTime : time;
  const times = !fitTime || TIMES.includes(fitTime) ? TIMES : [...TIMES, fitTime].sort();

  // ------------------------------------------------------------------ 5. profissional
  const [professionalId, setProfessionalId] = useState("");
  /** profissionais livres no horário escolhido (null = ainda carregando / sem horário) */
  const freeIds: string[] | null = !chosenTime
    ? null
    : fit
      ? fitSlot === undefined ? null : (fitSlot?.professionalIds ?? [])
      : (slots?.find((s) => s.time === time)?.professionalIds ?? null);
  const freePros = freeIds ? professionals.filter((p) => freeIds.includes(p.id)) : [];
  const freeKey = freeIds?.join(",") ?? "";

  useEffect(() => {
    if (freeIds === null) {
      if (!chosenTime) setProfessionalId("");
      return;
    }
    const wanted = pendingInitial.current?.professionalId;
    if (wanted) {
      pendingInitial.current = null;
      if (freeIds.includes(wanted)) return setProfessionalId(wanted);
    }
    if (freeIds.length === 1) setProfessionalId(freeIds[0]);
    else if (professionalId && !freeIds.includes(professionalId)) setProfessionalId("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [freeKey, chosenTime]);

  // pacote que vence antes da data escolhida sai
  useEffect(() => {
    if (pkg?.expires_at && pkg.expires_at < date) {
      setPackageId(null);
      toast.info(`O pacote ${pkg.name} vence em ${br(pkg.expires_at)}, antes desta data; ficou sem pacote.`);
    }
  }, [pkg, date]);

  // ------------------------------------------------------------------ 6. observações e repetir
  const [notes, setNotes] = useState("");
  const [repeat, setRepeat] = useState(false);
  const [frequency, setFrequency] = useState<SeriesFrequency>("weekly");
  const [count, setCount] = useState("4");
  const [preview, setPreview] = useState<Preview | null>(null);
  // recorrência: qualquer mudança nos dados invalida a prévia
  useEffect(() => {
    setPreview(null);
  }, [serviceId, professionalId, date, chosenTime, phoneKey, packageId, repeat, frequency, count]);

  const n = Math.min(Math.max(Number(count) || 0, 0), 52);
  const okDates = preview?.dates.filter((d) => !d.issue) ?? [];
  const packageShort = preview && packageId && preview.packageFit !== null && preview.packageFit < n ? preview.packageFit : null;

  // ------------------------------------------------------------------ abrir / enviar
  function fill(init?: Props["initial"]) {
    setPhone("");
    setPhoneCountry(BR);
    setName("");
    setLookup(null);
    setPackageId(null);
    setPackageChoosing(null);
    setServiceId("");
    setDate(init?.date ?? defaultDate);
    setTime("");
    setFit(false);
    setFitTime("");
    setProfessionalId("");
    pendingInitial.current = init?.time ? init : null;
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

  function seriesInput(): SeriesInput {
    return {
      serviceId, professionalId, date, time: chosenTime, frequency, count: n,
      customerName: name, customerPhone: phone, customerPhoneCountry: phoneCountry, notes, packageId,
    };
  }

  function validCustomer() {
    const msg = !phoneOk ? phoneError(phoneCountry) : name.trim().length < 2 ? "Informe o nome do cliente." : null;
    if (msg) setError(msg);
    return !msg;
  }

  function submitSeries() {
    if (n < 1) return setError("Escolha de 1 a 52 vezes.");
    if (!validCustomer()) return;
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
    if (!validCustomer()) return;
    start(async () => {
      const r = await createManualBooking({
        serviceId, professionalId, date, time: chosenTime, customerName: name, customerPhone: phone,
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

  const onlyOne = professionals.length === 1;
  const service = services.find((s) => s.id === serviceId);

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
            <DialogTitle className="font-heading text-2xl">Novo agendamento <Ajuda id="novo-agendamento" className="-ml-2" /></DialogTitle>
            <DialogDescription>Para clientes que marcaram por telefone ou no balcão. Já entra como confirmado.</DialogDescription>
          </DialogHeader>

          <form
            className="space-y-5"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            {/* 1. Cliente: WhatsApp primeiro; achou = nome preenchido */}
            <section className="space-y-3" aria-labelledby="nb-sec-cliente">
              <h3 id="nb-sec-cliente" className="text-sm font-semibold">Cliente</h3>
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
              <div className="space-y-1.5">
                <Label htmlFor="nb-name">
                  {lookup?.found === false && !name ? "Nome (cliente novo)" : "Nome do cliente"}
                </Label>
                <CustomerSearch
                  id="nb-name"
                  value={name}
                  onChange={setName}
                  // escolher preenche nome + WhatsApp; os pacotes vêm pela busca do WhatsApp
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
                <p className="min-h-5 text-xs text-muted-foreground" aria-live="polite" data-testid="status-cliente-manual">
                  {lookingUp && phoneKey ? (
                    "Procurando cliente…"
                  ) : lookup?.found ? (
                    <span className="inline-flex items-center gap-1 text-green-700">
                      <UserRound className="h-3.5 w-3.5" /> Cliente cadastrado
                    </span>
                  ) : lookup?.found === false ? (
                    "Cliente novo: confira o nome. O cadastro é feito ao salvar."
                  ) : (
                    "Digite o WhatsApp ou busque pelo nome."
                  )}
                </p>
              </div>
            </section>

            {/* 2. Pacote (opcional) */}
            {(packages.length > 0 || (canSellPackages && phoneOk)) && (
              <section className="space-y-2" aria-labelledby="nb-sec-pacote" data-testid="opcoes-pacote-manual">
                <h3 id="nb-sec-pacote" className="text-sm font-semibold">
                  Pacote <span className="font-normal text-muted-foreground">(opcional)</span>
                </h3>

                {packages.map((p) => {
                  const expired = !!p.expires_at && p.expires_at < date;
                  const using = packageId === p.id;
                  const usingItem = using ? p.items.find((i) => i.serviceId === serviceId) : null;
                  return (
                    <div
                      key={p.id}
                      className={cn("space-y-2 rounded-xl border p-3", using ? "border-primary bg-secondary/50" : "border-primary/30 bg-secondary/20")}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="min-w-0 text-sm">
                          <p className="font-semibold">{p.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {p.items.map((i) => `${i.serviceName}: restam ${i.remaining}`).join(" · ")}
                            {p.expires_at && ` · ${expired ? "vence antes desta data" : `vale até ${br(p.expires_at)}`}`}
                          </p>
                        </div>
                        {using ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="tap-target h-10"
                            onClick={() => setPackageId(null)}
                            data-testid={`btn-nao-usar-pacote-${p.id}`}
                          >
                            <X className="mr-1 h-4 w-4" /> Não usar
                          </Button>
                        ) : (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="tap-target h-10"
                            disabled={expired}
                            onClick={() => applyPackage(p)}
                            data-testid={`btn-usar-pacote-${p.id}`}
                          >
                            <Package className="mr-1 h-4 w-4" /> Usar pacote
                          </Button>
                        )}
                      </div>
                      {using && usingItem && (
                        <p className="flex items-center gap-1 text-xs font-medium text-green-700">
                          <Check className="h-3.5 w-3.5" /> Usando 1 sessão de {usingItem.serviceName}
                        </p>
                      )}
                      {packageChoosing === p.id && !using && (
                        <div className="flex flex-wrap gap-2" data-testid={`servicos-pacote-${p.id}`}>
                          <p className="w-full text-xs text-muted-foreground">Qual serviço do pacote?</p>
                          {p.items.map((i) => (
                            <Button
                              key={i.serviceId}
                              type="button"
                              variant="outline"
                              className="h-11"
                              onClick={() => applyPackage(p, i.serviceId)}
                              data-testid={`btn-pacote-servico-${i.serviceId}`}
                            >
                              {i.serviceName} · restam {i.remaining}
                            </Button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* vender pacote sem sair da Agenda (mesmo diálogo da ficha do cliente) */}
                {canSellPackages && phoneOk && (
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
              </section>
            )}

            {/* 3. Serviço (inclui combos) */}
            <div className="space-y-1.5">
              <Label>Serviço</Label>
              <Select value={serviceId} onValueChange={(v) => changeService(v)}>
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

            {/* 4. Data e horário */}
            <section className="space-y-3" aria-labelledby="nb-sec-horario">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label id="nb-sec-horario">Data</Label>
                  <Popover open={calOpen} onOpenChange={setCalOpen}>
                    <PopoverTrigger asChild>
                      <Button type="button" variant="outline" className="h-11 justify-start gap-2 font-normal" data-testid="btn-data-manual">
                        <CalendarDays className="h-4 w-4 text-primary" />
                        {format(parseISO(date), "EEE, dd/MM/yyyy", { locale: ptBR })}
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
                {serviceId && (
                  <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="h-5 w-5 accent-primary"
                      checked={fit}
                      onChange={(e) => {
                        setFit(e.target.checked);
                        if (e.target.checked && !fitTime && time) setFitTime(time);
                      }}
                      data-testid="check-encaixe-manual"
                    />
                    Encaixe (fora da lista)
                  </label>
                )}
                {serviceId && <Ajuda id="encaixe" className="-ml-2 self-center" />}
              </div>

              {!serviceId ? (
                <p className="rounded-lg bg-secondary/40 p-3 text-sm text-muted-foreground">Escolha o serviço para ver os horários livres.</p>
              ) : fit ? (
                <div className="space-y-1.5">
                  <Label>Horário do encaixe</Label>
                  <Select value={fitTime} onValueChange={setFitTime}>
                    <SelectTrigger className="h-11 w-40" data-testid="select-horario-manual"><SelectValue placeholder="--:--" /></SelectTrigger>
                    <SelectContent className="max-h-64">
                      {times.map((t) => (
                        <SelectItem key={t} value={t}>{t}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Sem conferir o expediente. Bloqueios e horários ocupados continuam valendo.
                  </p>
                </div>
              ) : slotsError ? (
                <p className="rounded-lg bg-red-50 p-3 text-sm text-destructive">{slotsError}</p>
              ) : !slots ? (
                <p className="flex items-center gap-2 p-3 text-sm text-muted-foreground" data-testid="horarios-carregando">
                  <Loader2 className="h-4 w-4 animate-spin" /> Carregando horários…
                </p>
              ) : slots.length === 0 ? (
                <p className="rounded-lg bg-secondary/40 p-3 text-sm text-muted-foreground" data-testid="sem-horarios-manual">
                  Nenhum horário livre nesta data{service ? ` para ${service.name}` : ""}. Escolha outra data ou use o encaixe.
                </p>
              ) : (
                <div
                  role="radiogroup"
                  aria-label="Horários livres"
                  className="grid max-h-60 grid-cols-3 gap-2 overflow-y-auto p-0.5 sm:grid-cols-5"
                  data-testid="grade-horarios-manual"
                >
                  {slots.map((s) => {
                    const sel = time === s.time;
                    const many = s.professionalIds.length;
                    return (
                      <button
                        key={s.time}
                        type="button"
                        role="radio"
                        aria-checked={sel}
                        aria-label={many > 1 ? `${s.time}, ${many} profissionais livres` : s.time}
                        onClick={() => setTime(s.time)}
                        className={cn(
                          "h-11 rounded-lg border text-sm font-medium tabular-nums transition-colors",
                          sel ? "border-primary bg-primary text-primary-foreground" : "bg-background hover:border-primary/60"
                        )}
                        data-testid={`btn-horario-${s.time.replace(":", "")}`}
                      >
                        {s.time}
                        {many > 1 && (
                          <span className={cn("ml-1 text-xs font-normal", sel ? "text-primary-foreground/80" : "text-muted-foreground")}>
                            · {many}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </section>

            {/* 5. Profissional: só os livres no horário */}
            {chosenTime && serviceId && (
              <div className="space-y-1.5">
                <Label>Profissional</Label>
                {freeIds === null ? (
                  <p className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" /> Conferindo quem está livre…
                  </p>
                ) : freePros.length === 0 ? (
                  <p className="rounded-lg bg-secondary/40 p-3 text-sm text-muted-foreground" data-testid="sem-profissional-manual">
                    Nenhum profissional livre às {chosenTime} para este serviço.
                  </p>
                ) : onlyOne ? (
                  <p className="flex min-h-11 items-center rounded-lg border bg-secondary/30 px-3 text-sm" data-testid="profissional-fixo-manual">
                    {freePros[0].name}
                  </p>
                ) : (
                  <Select value={professionalId} onValueChange={setProfessionalId}>
                    <SelectTrigger className="h-11" data-testid="select-profissional-manual"><SelectValue placeholder="Escolha o profissional" /></SelectTrigger>
                    <SelectContent>
                      {freePros.map((p) => (
                        <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            )}

            {/* 6. Observações e repetir */}
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
                  <Ajuda id="repetir" className="ml-auto" />
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
                          {preview.packageExpires ? ` até ${br(preview.packageExpires)}` : ""}.
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
                          <span className={cn(d.issue && "text-muted-foreground line-through")}>{shortDate(d.date)} às {chosenTime}</span>
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
                pending || !serviceId || !professionalId || !chosenTime || !freeIds?.includes(professionalId) ||
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
