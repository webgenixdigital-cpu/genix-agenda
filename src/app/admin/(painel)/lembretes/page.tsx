import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getAdminContext } from "@/lib/admin";
import { todayISO } from "@/lib/dates";
import { longDate, maskPhone, whatsappLink } from "@/lib/format";
import { StatusBadge } from "@/components/admin/status-badge";
import { SendReminderButton, UndoReminderButton } from "@/components/admin/lembretes/reminder-actions";
import type { BookingStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

type Props = { searchParams: { dia?: string } };

function reminderMessage(name: string, service: string, pro: string, date: string, time: string, business: string, isToday: boolean) {
  const first = name.split(" ")[0];
  return (
    `Olá, ${first}! Passando para lembrar do seu horário ${isToday ? "hoje" : "amanhã"} ⏰\n\n` +
    `• ${service}\n• Com ${pro}\n• ${longDate(date)}, às ${time.slice(0, 5)}\n\n` +
    `Pode confirmar sua presença respondendo esta mensagem? Se precisar remarcar, é só avisar.\n${business}`
  );
}

export default async function LembretesPage({ searchParams }: Props) {
  const { business } = await getAdminContext();
  const supabase = createClient();

  const isToday = searchParams.dia === "hoje";
  const date = todayISO(isToday ? 0 : 1);

  const { data } = await supabase
    .from("bookings")
    .select("id, start_time, customer_name, customer_phone, service_name, professional_name, status, reminder_sent_at")
    .eq("business_id", business.id)
    .eq("booking_date", date)
    .in("status", ["pending", "confirmed"])
    .order("start_time");

  const list = data ?? [];
  const queue = list.filter((b) => !b.reminder_sent_at);
  const sent = list.filter((b) => b.reminder_sent_at);

  const tabs = [
    { key: "amanha", label: "Amanhã", href: "/admin/lembretes", active: !isToday },
    { key: "hoje", label: "Hoje", href: "/admin/lembretes?dia=hoje", active: isToday },
  ];

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-4 md:p-8">
      <header>
        <h1 className="text-3xl md:text-4xl">Lembretes</h1>
        <p className="mt-1 max-w-lg text-sm text-muted-foreground">
          Um toque abre o WhatsApp com a mensagem pronta e tira o cliente da fila. Lembrar na véspera reduz faltas.
        </p>
      </header>

      <nav className="inline-flex rounded-xl border bg-white p-1" aria-label="Dia">
        {tabs.map((t) => (
          <Link
            key={t.key}
            href={t.href}
            data-testid={`tab-lembretes-${t.key}`}
            className={cn(
              "inline-flex h-10 items-center rounded-lg px-5 text-sm font-medium transition-colors",
              t.active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      <p className="text-sm font-semibold first-letter:uppercase">
        {longDate(date)} · {queue.length} na fila, {sent.length} {sent.length === 1 ? "lembrado" : "lembrados"}
      </p>

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
              reminderMessage(b.customer_name, b.service_name, b.professional_name, date, b.start_time, business.name, isToday)
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
            {sent.map((b) => (
              <li key={b.id} className="flex items-center gap-3 p-4">
                <CheckCircle2 className="h-5 w-5 shrink-0 text-green-600" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">
                    {b.start_time.slice(0, 5)} · {b.customer_name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Lembrete enviado às{" "}
                    {new Intl.DateTimeFormat("pt-BR", {
                      timeZone: "America/Sao_Paulo",
                      hour: "2-digit",
                      minute: "2-digit",
                    }).format(new Date(b.reminder_sent_at!))}
                  </p>
                </div>
                <UndoReminderButton id={b.id} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}