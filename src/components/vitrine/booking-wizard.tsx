"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Script from "next/script";
import { format, addDays, startOfDay } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ArrowLeft, Check, Loader2, MessageCircle, UserRound } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { BOOK_EVENT } from "@/components/vitrine/book-trigger";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { brl, duration, longDate, maskPhone, whatsappLink } from "@/lib/format";
import type { BusinessHour, Professional, Service } from "@/lib/types";
import { cn } from "@/lib/utils";
import { createPublicBooking } from "@/app/v/[slug]/actions";

// ---------------------------------------------------------------------
// PARTE 1 — Tipos e constantes
// ---------------------------------------------------------------------
type Props = {
  slug: string;
  businessName: string;
  whatsapp: string | null;
  services: Service[];
  professionals: Professional[];
  hours: BusinessHour[];
};

type Slot = { slot_time: string; professional_ids: string[] };

type Confirmation = {
  id: string;
  service_name: string;
  professional_name: string;
  date: string;
  start_time: string;
  end_time: string;
  price: number;
  customer_name: string;
};

const STEPS = ["Serviço", "Profissional", "Data e horário", "Seus dados"];
const ANY = "any";

const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

type TurnstileApi = {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  reset: (id?: string) => void;
  remove: (id: string) => void;
};
declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

// ---------------------------------------------------------------------
// PARTE 2 — Componente
// ---------------------------------------------------------------------
export function BookingWizard({ slug, businessName, whatsapp, services, professionals, hours }: Props) {
  const supabase = useMemo(() => createClient(), []);

  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [serviceId, setServiceId] = useState<string | null>(null);
  const [proId, setProId] = useState<string>(ANY);
  const [date, setDate] = useState<Date | undefined>();
  const [time, setTime] = useState<string | null>(null);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [links, setLinks] = useState<{ professional_id: string; service_id: string }[] | null>(null);

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Confirmation | null>(null);
  const [limitHit, setLimitHit] = useState(false);
  const [token, setToken] = useState("");

  const service = services.find((s) => s.id === serviceId) ?? null;
  const closedDays = hours.filter((h) => h.closed).map((h) => h.weekday);
  const today = startOfDay(new Date());

  // Abre pelo evento disparado pelos botões "Agendar"
  useEffect(() => {
    const handler = (e: Event) => {
      const id = (e as CustomEvent<{ serviceId?: string }>).detail?.serviceId;
      reset();
      if (id) {
        setServiceId(id);
        setStep(1);
      }
      setOpen(true);
    };
    window.addEventListener(BOOK_EVENT, handler);
    return () => window.removeEventListener(BOOK_EVENT, handler);
  }, []);

  // Carrega quais serviços cada profissional atende (uma vez)
  useEffect(() => {
    if (!open || links) return;
    supabase
      .from("professional_services")
      .select("professional_id, service_id")
      .in("professional_id", professionals.map((p) => p.id))
      .then(({ data }) => setLinks(data ?? []));
  }, [open, links, professionals, supabase]);

  // Profissionais que fazem o serviço escolhido (sem vínculo = faz todos)
  const eligiblePros = useMemo(() => {
    if (!service || !links) return professionals;
    return professionals.filter((p) => {
      const own = links.filter((l) => l.professional_id === p.id);
      return own.length === 0 || own.some((l) => l.service_id === service.id);
    });
  }, [service, links, professionals]);

  // Busca horários livres sempre que muda data/serviço/profissional
  useEffect(() => {
    if (!date || !serviceId) return;
    let cancel = false;
    setLoadingSlots(true);
    setTime(null);
    supabase
      .rpc("get_available_slots", {
        p_slug: slug,
        p_service_id: serviceId,
        p_date: format(date, "yyyy-MM-dd"),
        p_professional_id: proId === ANY ? null : proId,
      })
      .then(({ data }) => {
        if (cancel) return;
        setSlots((data as Slot[]) ?? []);
        setLoadingSlots(false);
      });
    return () => {
      cancel = true;
    };
  }, [date, serviceId, proId, slug, supabase]);

  function reset() {
    setStep(0);
    setServiceId(null);
    setProId(ANY);
    setDate(undefined);
    setTime(null);
    setSlots([]);
    setError(null);
    setDone(null);
    setLimitHit(false);
    setToken("");
  }

  async function submit() {
    if (!service || !date || !time) return;
    setSending(true);
    setError(null);
    setLimitHit(false);
    const r = await createPublicBooking({
      slug,
      serviceId: service.id,
      date: format(date, "yyyy-MM-dd"),
      time,
      name,
      phone,
      notes: notes || null,
      professionalId: proId === ANY ? null : proId,
      token,
    });
    setSending(false);
    if (!r) return;

    if (!r.ok) {
      // o token do Turnstile é de uso único: pede outro
      setToken("");
      window.dispatchEvent(new Event(TURNSTILE_RESET));
      setError(r.error);
      if (r.code === "LIMITE_ESPACO" || r.code === "LIMITE_DIARIO") setLimitHit(true);
      if (r.code === "HORARIO_INDISPONIVEL") {
        setStep(2);
        setDate(new Date(date)); // força recarregar os horários
      }
      return;
    }
    setDone(r.booking);
  }

  const phoneDigits = phone.replace(/\D/g, "");
  const canSubmit = name.trim().length >= 2 && phoneDigits.length >= 10 && !!token && !sending;

  const waText = done
    ? `Olá, ${businessName}! Acabei de agendar pelo site:\n\n` +
      `• ${done.service_name}\n• Com ${done.professional_name}\n` +
      `• ${longDate(done.date)}, às ${done.start_time}\n\nNome: ${done.customer_name}`
    : "";
  const waConfirm = whatsappLink(whatsapp, waText);

  // -------------------------------------------------------------------
  // PARTE 3 — Interface
  // -------------------------------------------------------------------
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[92svh] w-[calc(100%-1.5rem)] max-w-xl overflow-y-auto rounded-2xl p-6 md:p-8">
        {done ? (
          /* ---------- SUCESSO ---------- */
          <div className="text-center" data-testid="booking-success">
            <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-green-100 text-green-700">
              <Check className="h-7 w-7" />
            </div>
            <DialogTitle className="mt-4 font-heading text-3xl">Pedido de agendamento enviado</DialogTitle>
            <DialogDescription className="mt-2">
              {businessName} vai confirmar seu horário. Avise pelo WhatsApp para agilizar.
            </DialogDescription>

            <dl className="mt-6 space-y-2 rounded-xl bg-secondary p-4 text-left text-sm">
              <Row label="Serviço" value={done.service_name} />
              <Row label="Profissional" value={done.professional_name} />
              <Row label="Data" value={longDate(done.date)} />
              <Row label="Horário" value={`${done.start_time} às ${done.end_time}`} />
              <Row label="Valor" value={brl(done.price)} />
            </dl>

            <div className="mt-6 grid gap-2">
              {waConfirm && (
                <Button asChild className="h-12 bg-whatsapp text-base text-white hover:bg-whatsapp-hover">
                  <a href={waConfirm} target="_blank" rel="noopener noreferrer" data-testid="btn-whatsapp-confirmacao">
                    <MessageCircle className="mr-2 h-5 w-5" /> Avisar pelo WhatsApp
                  </a>
                </Button>
              )}
              <Button variant="ghost" className="h-11" onClick={() => setOpen(false)}>
                Fechar
              </Button>
            </div>
          </div>
        ) : (
          <>
            <DialogHeader className="text-left">
              <div className="flex items-center gap-2">
                {step > 0 && (
                  <button
                    onClick={() => setStep(step - 1)}
                    className="-ml-2 grid h-10 w-10 place-items-center rounded-full hover:bg-secondary"
                    aria-label="Voltar"
                    data-testid="btn-voltar-etapa"
                  >
                    <ArrowLeft className="h-5 w-5" />
                  </button>
                )}
                <p className="text-sm text-muted-foreground">
                  Passo {step + 1} de 4
                </p>
              </div>
              <DialogTitle className="font-heading text-3xl">{STEPS[step]}</DialogTitle>
              <DialogDescription className="sr-only">Agendamento em {businessName}</DialogDescription>
              <div className="mt-3 flex gap-1.5" aria-hidden>
                {STEPS.map((_, i) => (
                  <span key={i} className={cn("h-1 flex-1 rounded-full", i <= step ? "bg-primary" : "bg-border")} />
                ))}
              </div>
            </DialogHeader>

            {/* Resumo do que já foi escolhido */}
            {service && step > 0 && (
              <p className="mt-4 rounded-lg bg-secondary px-3 py-2 text-sm">
                <strong>{service.name}</strong> · {duration(service.duration_min)} · {brl(service.price)}
                {step > 1 && <> · {proId === ANY ? "Qualquer profissional" : professionals.find((p) => p.id === proId)?.name}</>}
                {step > 2 && date && time && <> · {format(date, "dd/MM")} às {time}</>}
              </p>
            )}

            <div className="mt-5">
              {/* ---------- PASSO 1: SERVIÇO ---------- */}
              {step === 0 && (
                <ul className="space-y-2">
                  {services.map((s) => (
                    <li key={s.id}>
                      <button
                        onClick={() => {
                          setServiceId(s.id);
                          setProId(ANY);
                          setStep(1);
                        }}
                        className="flex min-h-14 w-full items-center justify-between gap-3 rounded-xl border bg-card p-4 text-left transition-colors hover:border-primary"
                        data-testid={`wizard-servico-${s.id}`}
                      >
                        <span>
                          <span className="block font-semibold">{s.name}</span>
                          <span className="text-sm text-muted-foreground">{duration(s.duration_min)}</span>
                        </span>
                        <span className="font-semibold">{brl(s.price)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              {/* ---------- PASSO 2: PROFISSIONAL ---------- */}
              {step === 1 && (
                <ul className="space-y-2">
                  {eligiblePros.length > 1 && (
                    <li>
                      <ProOption
                        selected={false}
                        title="Qualquer profissional"
                        subtitle="Mostra mais horários disponíveis"
                        onClick={() => {
                          setProId(ANY);
                          setStep(2);
                        }}
                        testId="wizard-profissional-qualquer"
                      />
                    </li>
                  )}
                  {eligiblePros.map((p) => (
                    <li key={p.id}>
                      <ProOption
                        selected={false}
                        title={p.name}
                        subtitle={p.role ?? undefined}
                        photo={p.photo_url}
                        onClick={() => {
                          setProId(p.id);
                          setStep(2);
                        }}
                        testId={`wizard-profissional-${p.id}`}
                      />
                    </li>
                  ))}
                </ul>
              )}

              {/* ---------- PASSO 3: DATA E HORÁRIO ---------- */}
              {step === 2 && (
                <div className="space-y-5">
                  {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-destructive">{error}</p>}
                  <div className="flex justify-center rounded-xl border bg-card">
                    <Calendar
                      mode="single"
                      locale={ptBR}
                      selected={date}
                      onSelect={(d) => {
                        setDate(d);
                        setError(null);
                      }}
                      disabled={[{ before: today }, { after: addDays(today, 60) }, { dayOfWeek: closedDays }]}
                      data-testid="wizard-calendario"
                    />
                  </div>

                  {date && (
                    <div>
                      <p className="mb-3 text-sm font-semibold first-letter:uppercase">{longDate(format(date, "yyyy-MM-dd"))}</p>
                      {loadingSlots ? (
                        <div className="grid grid-cols-4 gap-2 sm:grid-cols-5">
                          {Array.from({ length: 10 }).map((_, i) => (
                            <Skeleton key={i} className="h-11 rounded-lg" />
                          ))}
                        </div>
                      ) : slots.length === 0 ? (
                        <p className="rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground">
                          Nenhum horário livre neste dia. Escolha outra data no calendário.
                        </p>
                      ) : (
                        <div className="grid grid-cols-4 gap-2 sm:grid-cols-5">
                          {slots.map((s) => (
                            <button
                              key={s.slot_time}
                              onClick={() => setTime(s.slot_time)}
                              className={cn(
                                "h-11 rounded-lg border text-sm font-semibold transition-colors",
                                time === s.slot_time
                                  ? "border-primary bg-primary text-primary-foreground"
                                  : "bg-card hover:border-primary"
                              )}
                              data-testid={`wizard-horario-${s.slot_time.replace(":", "")}`}
                            >
                              {s.slot_time}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  <Button
                    className="h-12 w-full text-base"
                    disabled={!date || !time}
                    onClick={() => {
                      setError(null);
                      setStep(3);
                    }}
                    data-testid="btn-continuar-horario"
                  >
                    Continuar
                  </Button>
                </div>
              )}

              {/* ---------- PASSO 4: DADOS ---------- */}
              {step === 3 && (
                <form
                  className="space-y-4"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (canSubmit) submit();
                  }}
                >
                  <div className="space-y-1.5">
                    <Label htmlFor="bk-name">Seu nome</Label>
                    <Input
                      id="bk-name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      autoComplete="name"
                      className="h-12 text-base"
                      data-testid="input-nome-cliente"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="bk-phone">WhatsApp com DDD</Label>
                    <Input
                      id="bk-phone"
                      value={phone}
                      onChange={(e) => setPhone(maskPhone(e.target.value))}
                      inputMode="tel"
                      autoComplete="tel"
                      placeholder="(35) 99999-9999"
                      className="h-12 text-base"
                      data-testid="input-whatsapp-phone"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="bk-notes">Observações (opcional)</Label>
                    <Textarea
                      id="bk-notes"
                      value={notes}
                      onChange={(e) => setNotes(e.target.value.slice(0, 500))}
                      rows={3}
                      data-testid="input-observacoes"
                    />
                  </div>

                  <TurnstileWidget onToken={setToken} />

                  {error && (
                    <div className="space-y-3 rounded-lg bg-red-50 p-3 text-sm text-destructive" data-testid="booking-error">
                      <p>{error}</p>
                      {limitHit && whatsapp && (
                        <Button asChild className="h-11 w-full bg-whatsapp text-white hover:bg-whatsapp-hover">
                          <a
                            href={whatsappLink(whatsapp, `Olá, ${businessName}! Quero marcar mais um horário.`) ?? undefined}
                            target="_blank"
                            rel="noopener noreferrer"
                            data-testid="btn-whatsapp-limite"
                          >
                            <MessageCircle className="h-5 w-5" /> Falar com o espaço no WhatsApp
                          </a>
                        </Button>
                      )}
                    </div>
                  )}

                  <Button type="submit" className="h-12 w-full text-base" disabled={!canSubmit} data-testid="btn-confirm-booking">
                    {sending ? <Loader2 className="h-5 w-5 animate-spin" /> : "Confirmar agendamento"}
                  </Button>
                </form>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------
// PARTE 4 — Subcomponentes
// ---------------------------------------------------------------------
function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-semibold first-letter:uppercase">{value}</dd>
    </div>
  );
}

function ProOption(props: {
  selected: boolean;
  title: string;
  subtitle?: string;
  photo?: string | null;
  onClick: () => void;
  testId: string;
}) {
  return (
    <button
      onClick={props.onClick}
      data-testid={props.testId}
      className="flex min-h-16 w-full items-center gap-3 rounded-xl border bg-card p-3 text-left transition-colors hover:border-primary"
    >
      <span className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-full bg-secondary text-primary">
        {props.photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={props.photo} alt="" className="h-full w-full object-cover" />
        ) : props.title === "Qualquer profissional" ? (
          <UserRound className="h-5 w-5" />
        ) : (
          <span className="font-heading text-lg">{props.title.charAt(0)}</span>
        )}
      </span>
      <span>
        <span className="block font-semibold">{props.title}</span>
        {props.subtitle && <span className="text-sm text-muted-foreground">{props.subtitle}</span>}
      </span>
    </button>
  );
}
// ---------------------------------------------------------------------
// PARTE 5 — Cloudflare Turnstile (modo Managed)
// ---------------------------------------------------------------------
const TURNSTILE_RESET = "genix:turnstile-reset";

function TurnstileWidget({ onToken }: { onToken: (t: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  const [ready, setReady] = useState(typeof window !== "undefined" && !!window.turnstile);

  const mount = useCallback(() => {
    if (!TURNSTILE_SITE_KEY || !ref.current || !window.turnstile || widgetId.current) return;
    widgetId.current = window.turnstile.render(ref.current, {
      sitekey: TURNSTILE_SITE_KEY,
      language: "pt-br",
      callback: (t: string) => onToken(t),
      // token vale 5 min: ao expirar, trava o botão e o widget renova sozinho
      "refresh-expired": "auto",
      "expired-callback": () => onToken(""),
      "timeout-callback": () => onToken(""),
      "error-callback": () => onToken(""),
    });
  }, [onToken]);

  useEffect(() => {
    if (ready) mount();
  }, [ready, mount]);

  useEffect(() => {
    const reset = () => widgetId.current && window.turnstile?.reset(widgetId.current);
    window.addEventListener(TURNSTILE_RESET, reset);
    return () => {
      window.removeEventListener(TURNSTILE_RESET, reset);
      if (widgetId.current) window.turnstile?.remove(widgetId.current);
      widgetId.current = null;
      onToken("");
    };
  }, [onToken]);

  if (!TURNSTILE_SITE_KEY) {
    return (
      <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900" data-testid="turnstile-sem-chave">
        {process.env.NODE_ENV === "production"
          ? "Agendamento online indisponível no momento. Fale com o espaço pelo WhatsApp."
          : "Turnstile não configurado: defina NEXT_PUBLIC_TURNSTILE_SITE_KEY no .env.local."}
      </p>
    );
  }

  return (
    <>
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        strategy="afterInteractive"
        onReady={() => setReady(true)}
      />
      <div ref={ref} className="min-h-[65px]" data-testid="turnstile-widget" />
    </>
  );
}
