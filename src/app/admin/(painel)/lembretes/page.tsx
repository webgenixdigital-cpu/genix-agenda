import Link from "next/link";
import { AlertCircle, Bot, CheckCircle2 } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getAdminContext } from "@/lib/admin";
import { getPlanContext } from "@/lib/plan";
import { LockedFeature } from "@/components/admin/locked-feature";
import { todayISO } from "@/lib/dates";
import { longDate, maskPhone, whatsappLink } from "@/lib/format";
import { manualReminderText } from "@/lib/messages";
import { ReminderTextDialog } from "@/components/admin/lembretes/reminder-text-dialog";
import { KIND_LABEL, MESSAGE_KINDS, reasonLabel, type MessageKind } from "@/lib/whatsapp/templates";
import { StatusBadge } from "@/components/admin/status-badge";
import { SendReminderButton, UndoReminderButton } from "@/components/admin/lembretes/reminder-actions";
import { ReturnQueue } from "@/components/admin/lembretes/return-queue";
import type { BookingStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

type Props = { searchParams: { dia?: string } };

type AutoSend = {
  booking_id: string;
  kind: MessageKind;
  booking_date: string;
  start_time: string;
  attempt: number;
  status: "queued" | "sending" | "sent" | "failed" | "skipped";
  reason: string | null;
  retryable: boolean;
  sent_at: string | null;
};

const hhmm = (ts: string) =>
  new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" }).format(new Date(ts));

export default async function LembretesPage({ searchParams }: Props) {
  const { business, role } = await getAdminContext();
  const plan = await getPlanContext(business.id);


  const supabase = createClient();

  const isReturns = searchParams.dia === "retornos";
  // Grátis: a fila manual de lembretes é liberada; os Retornos continuam nos planos pagos
  if (isReturns && plan.tier === "gratis") return <LockedFeature feature="retornos" />;
  const isToday = searchParams.dia === "hoje";
  const date = todayISO(isToday ? 0 : 1);

  const { data } = await supabase
    .from("bookings")
    .select("id, start_time, customer_name, customer_phone, service_name, professional_name, status, reminder_sent_at, price, items_count")
    .eq("business_id", business.id)
    .eq("booking_date", date)
    .in("status", ["pending", "confirmed"])
    .order("start_time");

  const list = data ?? [];
  const queue = list.filter((b) => !b.reminder_sent_at);
  const sent = list.filter((b) => b.reminder_sent_at);

  // envios automáticos de todos os tipos (42), por agendamento
  const SEND_COLS = "booking_id, booking_date, start_time, attempt, status, reason, retryable, sent_at";
  const loadSends = async (): Promise<AutoSend[]> => {
    if (!list.length) return [];
    const q = (cols: string) =>
      supabase.from("whatsapp_reminder_sends").select(cols).in("booking_id", list.map((b) => b.id)).order("attempt");
    const r = await q(`${SEND_COLS}, kind`);
    // 42703 = coluna não existe: a migration 42 ainda não rodou (tudo é véspera)
    if (r.error?.code === "42703") {
      const old = await q(SEND_COLS);
      return ((old.data ?? []) as unknown as Omit<AutoSend, "kind">[]).map((s) => ({ ...s, kind: "eve" as const }));
    }
    return (r.data ?? []) as unknown as AutoSend[];
  };
  const [sends, { data: waSettings }, { data: manualTexts }] = await Promise.all([
    loadSends(),
    supabase.from("whatsapp_settings").select("auto_enabled").eq("business_id", business.id).maybeSingle(),
    // textos da fila manual (41); sem linha ou com erro = texto padrão
    supabase.from("manual_reminder_texts").select("text_tomorrow, text_today").eq("business_id", business.id).maybeSingle(),
  ]);
  const savedText = isToday ? manualTexts?.text_today : manualTexts?.text_tomorrow;
  const canEditText = role === "owner" || role === "reception";
  // véspera: última tentativa da data/hora atual (decide o selo e o aviso de falha da fila manual)
  // outros tipos: o resultado mais recente de cada tipo, para o histórico do agendamento
  const lastSend = new Map<string, AutoSend>();
  const otherSends = new Map<string, Map<MessageKind, AutoSend>>();
  for (const s of sends) {
    const b = list.find((x) => x.id === s.booking_id);
    if (!b || s.booking_date !== date || s.start_time !== b.start_time) continue;
    if (s.kind === "eve") {
      if (s.status !== "queued") lastSend.set(s.booking_id, s);
      continue;
    }
    const byKind = otherSends.get(s.booking_id) ?? new Map<MessageKind, AutoSend>();
    byKind.set(s.kind, s);
    otherSends.set(s.booking_id, byKind);
  }

  const tabs = [
    { key: "amanha", label: "Amanhã", href: "/admin/lembretes", active: !isToday && !isReturns },
    { key: "hoje", label: "Hoje", href: "/admin/lembretes?dia=hoje", active: isToday },
    { key: "retornos", label: "Retornos", href: "/admin/lembretes?dia=retornos", active: isReturns },
  ];

  return (
    <main className="mx-auto max-w-3xl space-y-8 p-4 md:p-8">
      <header className="text-center">
        <h1 className="text-3xl md:text-4xl">Lembretes</h1>
        <p className="mx-auto mt-1 max-w-lg text-sm text-muted-foreground">
          Um toque abre o WhatsApp com a mensagem pronta e tira o cliente da fila. Lembrar na véspera reduz faltas.
        </p>
        {waSettings?.auto_enabled && (
          <p className="mx-auto mt-2 flex max-w-lg items-start gap-2 text-left text-sm text-muted-foreground" data-testid="lembretes-automatico-ativo">
            <Bot className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            Envio automático ligado: os confirmados recebem o lembrete a partir das 08:00 da véspera. Quem não receber continua aqui.
          </p>
        )}
      </header>

      <nav className="inline-flex rounded-xl border bg-white p-1" aria-label="Dia">
        {tabs.map((t) => (
          <Link
            key={t.key}
            href={t.href}
            data-testid={`tab-lembretes-${t.key}`}
            className={cn(
              "inline-flex h-11 items-center rounded-lg px-5 text-sm font-medium transition-colors",
              t.active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {isReturns ? (
        <ReturnQueue business={business} />
      ) : (
      <>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-semibold first-letter:uppercase">
          {longDate(date)} · {queue.length} na fila, {sent.length} {sent.length === 1 ? "lembrado" : "lembrados"}
        </p>
        {canEditText && (
          <ReminderTextDialog
            businessName={business.name}
            tomorrow={manualTexts?.text_tomorrow ?? null}
            today={manualTexts?.text_today ?? null}
          />
        )}
      </div>

      {/* Fila */}
      {queue.length === 0 ? (
        <div className="rounded-2xl border border-dashed bg-white p-10 text-center">
          <CheckCircle2 className="mx-auto h-10 w-10 text-green-600" />
          <p className="mt-3 font-heading text-2xl">
            {list.length === 0 ? "Nenhum atendimento nesse dia" : "Todos os clientes foram lembrados"}
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {queue.map((b) => {
            const href = whatsappLink(
              b.customer_phone,
              manualReminderText(savedText, isToday, {
                name: b.customer_name,
                service: b.service_name,
                pro: b.professional_name,
                date,
                time: b.start_time,
                business: business.name,
                itemsCount: b.items_count,
                price: b.price === null ? null : Number(b.price),
              })
            );
            return (
              <li key={b.id} className="flex flex-col gap-3 rounded-2xl border bg-card p-4 sm:flex-row sm:items-center" data-testid={`lembrete-${b.id}`}>
                <div className="w-14 shrink-0 text-lg font-semibold">{b.start_time.slice(0, 5)}</div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold">{b.customer_name}</p>
                    <StatusBadge status={b.status as BookingStatus} />
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {b.service_name} com {b.professional_name} · {maskPhone(b.customer_phone)}
                  </p>
                  <AutoFailure send={lastSend.get(b.id)} />
                  <OtherAutoMessages sends={otherSends.get(b.id)} />
                </div>
                {href && <SendReminderButton id={b.id} href={href} />}
              </li>
            );
          })}
        </ul>
      )}

      {/* Já lembrados */}
      {sent.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-sans text-sm font-semibold text-muted-foreground">Já lembrados</h2>
          <ul className="divide-y rounded-2xl border bg-card">
            {sent.map((b) => {
              const auto = lastSend.get(b.id);
              const isAuto = auto?.status === "sent" && !!auto.sent_at;
              return (
                <li key={b.id} className="flex items-center gap-3 p-4">
                  <CheckCircle2 className="h-5 w-5 shrink-0 text-green-600" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold">
                      {b.start_time.slice(0, 5)} · {b.customer_name}
                    </p>
                    {isAuto ? (
                      <p className="flex items-center gap-1 text-xs font-medium text-primary" data-testid={`selo-automatico-${b.id}`}>
                        <Bot className="h-3.5 w-3.5" /> Enviado automaticamente às {hhmm(auto.sent_at!)}
                      </p>
                    ) : (
                      <p className="text-xs text-muted-foreground">Lembrete enviado às {hhmm(b.reminder_sent_at!)}</p>
                    )}
                    <OtherAutoMessages sends={otherSends.get(b.id)} />
                  </div>
                  <UndoReminderButton id={b.id} />
                </li>
              );
            })}
          </ul>
        </section>
      )}
      </>
      )}
    </main>
  );
}

/** Mensagens automáticas dos outros tipos (confirmação, antes do horário) deste horário */
function OtherAutoMessages({ sends }: { sends?: Map<MessageKind, AutoSend> }) {
  if (!sends?.size) return null;
  const items = MESSAGE_KINDS.flatMap((k) => {
    const s = sends.get(k);
    if (!s) return [];
    if (s.status === "sent" && s.sent_at) return [{ k, ok: true, text: `${KIND_LABEL[k]}: enviada às ${hhmm(s.sent_at)}` }];
    if (s.status === "queued" || s.status === "sending") return [{ k, ok: true, text: `${KIND_LABEL[k]}: na fila` }];
    if (s.status === "failed" || (s.status === "skipped" && s.reason === "EXPIRADA")) {
      return [{ k, ok: false, text: `${KIND_LABEL[k]}: não saiu (${reasonLabel(s.reason)})` }];
    }
    return []; // descartes esperados (cancelado, remarcado, dispensada...) não aparecem aqui
  });
  if (!items.length) return null;
  return (
    <ul className="mt-1 space-y-0.5 text-xs" data-testid="lembrete-mensagens-automaticas">
      {items.map((i) => (
        <li key={i.k} className={cn("flex items-start gap-1", i.ok ? "text-primary" : "text-amber-800")}>
          {i.ok ? <Bot className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
          {i.text}
        </li>
      ))}
    </ul>
  );
}

/** Último motivo do lembrete de véspera automático que não saiu (fila manual) */
function AutoFailure({ send }: { send?: AutoSend }) {
  if (!send) return null;
  if (send.status === "skipped" && send.reason === "EXPIRADA") {
    return (
      <p className="mt-1 flex items-start gap-1 text-xs text-amber-800" data-testid="lembrete-falha-automatico">
        <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        Lembrete automático não saiu: {reasonLabel(send.reason)}. Envie pelo botão.
      </p>
    );
  }
  if (send.status !== "failed") return null;
  const willRetry = send.retryable && send.attempt === 1;
  return (
    <p className="mt-1 flex items-start gap-1 text-xs text-amber-800" data-testid="lembrete-falha-automatico">
      <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      Envio automático não saiu: {reasonLabel(send.reason)}.
      {willRetry ? " Uma nova tentativa sai em breve." : " Envie pelo botão."}
    </p>
  );
}
