import { CalendarOff, Globe, Phone, StickyNote } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getAdminContext } from "@/lib/admin";
import { getPlanContext } from "@/lib/plan";
import { todayISO } from "@/lib/dates";
import { brl, longDate, maskPhone } from "@/lib/format";
import { StatusBadge } from "@/components/admin/status-badge";
import { AgendaToolbar } from "@/components/admin/agenda/agenda-toolbar";
import { BookingActions, type AgendaBooking } from "@/components/admin/agenda/booking-actions";
import { NewBookingDialog } from "@/components/admin/agenda/new-booking-dialog";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

type Props = { searchParams: { data?: string; status?: string; prof?: string } };

const SOURCE: Record<string, string> = { online: "Vitrine", whatsapp: "WhatsApp", manual: "Manual" };
const STATUSES = ["pending", "confirmed", "completed", "cancelled"];

// ---------------------------------------------------------------------
// PARTE 1 — Dados
// ---------------------------------------------------------------------
export default async function AgendaPage({ searchParams }: Props) {
  const { business } = await getAdminContext();
  const plan = await getPlanContext(business.id);
  const supabase = createClient();

  const today = todayISO();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.data ?? "") ? searchParams.data! : today;
  const status = STATUSES.includes(searchParams.status ?? "") ? searchParams.status! : "all";
  const prof = searchParams.prof ?? "all";
  // "Pendentes" sem data escolhida = todos os pedidos pendentes a partir de hoje
  const pendingMode = status === "pending" && !searchParams.data;

  let q = supabase
    .from("bookings")
    .select("id, booking_date, start_time, end_time, customer_name, customer_phone, customer_notes, service_name, professional_name, professional_id, price, status, source")
    .eq("business_id", business.id)
    .order("booking_date")
    .order("start_time");
  q = pendingMode ? q.gte("booking_date", today) : q.eq("booking_date", date);
  if (status !== "all") q = q.eq("status", status);
  if (prof !== "all") q = q.eq("professional_id", prof);

  const [{ data: bookings }, { data: services }, { data: professionals }, { data: blocks }] = await Promise.all([
    q,
    supabase.from("services").select("id, name, price, duration_min")
      .eq("business_id", business.id).eq("active", true).order("sort_order"),
    supabase.from("professionals").select("id, name")
      .eq("business_id", business.id).eq("active", true).order("sort_order"),
    supabase.from("schedule_blocks").select("professional_id, time_start, time_end, reason, recurring, weekdays")
      .eq("business_id", business.id).lte("date_start", date).gte("date_end", date),
  ]);

  const list = (bookings ?? []) as (AgendaBooking & { professional_id: string })[];
  const pros = professionals ?? [];
  const weekday = new Date(`${date}T12:00:00`).getDay();
  const dayBlocks = pendingMode
    ? []
    : (blocks ?? []).filter((k) => !k.recurring || (k.weekdays as number[]).includes(weekday));

  // agrupa por dia (só faz diferença no modo "pendentes")
  const byDay = list.reduce<Record<string, typeof list>>((acc, b) => {
    (acc[b.booking_date] ??= []).push(b);
    return acc;
  }, {});

  const activeCount = list.filter((b) => b.status !== "cancelled").length;
  const expected = list.filter((b) => b.status !== "cancelled").reduce((s, b) => s + Number(b.price), 0);

  // -------------------------------------------------------------------
  // PARTE 2 — Página
  // -------------------------------------------------------------------
  return (
    <main className="mx-auto max-w-5xl space-y-6 p-4 md:p-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl md:text-4xl">{pendingMode ? "Pedidos pendentes" : "Agenda"}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {pendingMode
              ? `${list.length} ${list.length === 1 ? "pedido aguardando" : "pedidos aguardando"} confirmação`
              : `${activeCount} ${activeCount === 1 ? "atendimento" : "atendimentos"}, ${brl(expected)} previstos`}
          </p>
        </div>
        <NewBookingDialog defaultDate={date} services={services ?? []} professionals={pros} />
      </header>

      <AgendaToolbar
        date={date}
        today={today}
        status={status}
        professionalId={prof}
        pendingMode={pendingMode}
        professionals={pros}
      />

      {dayBlocks.length > 0 && (
        <div className="space-y-1 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-900" data-testid="aviso-bloqueio">
          {dayBlocks.map((k, i) => (
            <p key={i} className="flex items-start gap-2">
              <CalendarOff className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                <strong>{k.reason ?? "Bloqueio"}</strong>
                {" para "}
                {k.professional_id ? pros.find((p) => p.id === k.professional_id)?.name ?? "um profissional" : "toda a equipe"}
                {k.time_start ? `, das ${k.time_start.slice(0, 5)} às ${k.time_end?.slice(0, 5)}` : ", o dia inteiro"}
              </span>
            </p>
          ))}
        </div>
      )}

      {list.length === 0 && (
        <div className="rounded-2xl border border-dashed bg-white p-10 text-center">
          <p className="font-heading text-2xl">{pendingMode ? "Nenhum pedido pendente" : "Dia livre"}</p>
          <p className="mt-2 text-muted-foreground">
            {pendingMode
              ? "Todos os pedidos da vitrine já foram respondidos."
              : "Nenhum atendimento com esses filtros. Use “Novo agendamento” para marcar um horário."}
          </p>
        </div>
      )}

      {Object.entries(byDay).map(([day, items]) => (
        <section key={day} className="space-y-3">
          {pendingMode && <h2 className="font-sans text-sm font-semibold first-letter:uppercase">{longDate(day)}</h2>}
          <ul className="space-y-3">
            {items.map((b) => (
              <li
                key={b.id}
                className={cn(
                  "rounded-2xl border bg-card p-4 md:p-5",
                  b.status === "cancelled" && "opacity-60",
                  b.status === "pending" && "border-amber-300"
                )}
                data-testid={`agenda-item-${b.id}`}
              >
                <div className="flex gap-4">
                  <div className="w-16 shrink-0 border-r pr-4 text-center">
                    <p className="text-lg font-semibold">{b.start_time.slice(0, 5)}</p>
                    <p className="text-xs text-muted-foreground">até {b.end_time.slice(0, 5)}</p>
                  </div>

                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold">{b.customer_name}</p>
                      <StatusBadge status={b.status} />
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <Globe className="h-3 w-3" /> {SOURCE[b.source] ?? b.source}
                      </span>
                    </div>
                    <p className="text-sm">
                      {b.service_name} com {b.professional_name}
                      <span className="text-muted-foreground"> · {brl(b.price)}</span>
                    </p>
                    <p className="inline-flex items-center gap-1 text-sm text-muted-foreground">
                      <Phone className="h-3.5 w-3.5" /> {maskPhone(b.customer_phone)}
                    </p>
                    {b.customer_notes && (
                      <p className="flex items-start gap-1 rounded-lg bg-secondary px-2.5 py-1.5 text-sm">
                        <StickyNote className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" /> {b.customer_notes}
                      </p>
                    )}
                  </div>
                </div>

                <div className="mt-4 border-t pt-3">
                  <BookingActions booking={b} businessName={business.name} slug={business.slug} fullAccess={plan.tier === "completo"} />
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </main>
  );
}
