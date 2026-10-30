import Link from "next/link";
import { CalendarOff, Globe, Package, Phone, Repeat, StickyNote } from "lucide-react";
import { getAdminContext, seesWholeTeam } from "@/lib/admin";
import { getPlanContext } from "@/lib/plan";
import { addDaysISO, mondayOf, todayISO } from "@/lib/dates";
import { agendaProfessional, blockAppliesOn, loadAgenda } from "@/lib/agenda-data";
import { brl, longDate, maskPhone } from "@/lib/format";
import { StatusBadge } from "@/components/admin/status-badge";
import { AutoConfirmBadge } from "@/components/admin/auto-confirm-badge";
import { AgendaToolbar } from "@/components/admin/agenda/agenda-toolbar";
import { BookingActions } from "@/components/admin/agenda/booking-actions";
import { ViewPreference } from "@/components/admin/agenda/view-preference";
import { WeekGrid } from "@/components/admin/agenda/week-grid";
import { NewBookingDialog } from "@/components/admin/agenda/new-booking-dialog";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

type Props = { searchParams: { data?: string; status?: string; prof?: string; visao?: string; cancelados?: string } };

const SOURCE: Record<string, string> = { online: "Vitrine", whatsapp: "WhatsApp", manual: "Manual" };
const STATUSES = ["pending", "confirmed", "completed", "cancelled"];
const shortISO = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

// ---------------------------------------------------------------------
// PARTE 1 — Dados
// ---------------------------------------------------------------------
export default async function AgendaPage({ searchParams }: Props) {
  const ctx = await getAdminContext();
  const { business, role, professionalId } = ctx;
  const wholeTeam = seesWholeTeam(role);
  const plan = await getPlanContext(business.id);

  const today = todayISO();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.data ?? "") ? searchParams.data! : today;
  const view = searchParams.visao === "semana" ? "semana" : "dia";
  const prof = agendaProfessional(wholeTeam, searchParams.prof, professionalId);

  // ------------------------- VISÃO SEMANA -------------------------
  if (view === "semana") {
    const showCancelled = searchParams.cancelados === "1";
    const weekStart = mondayOf(date);
    const weekEnd = addDaysISO(weekStart, 6);
    const data = await loadAgenda(ctx, wholeTeam, {
      from: weekStart,
      to: weekEnd,
      status: "all",
      prof,
      withHours: true,
      hideCancelled: !showCancelled,
    });
    const activeCount = data.list.filter((b) => b.status !== "cancelled").length;

    return (
      <main className="mx-auto max-w-7xl space-y-6 p-4 md:p-8">
        <ViewPreference view={view} />
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl md:text-4xl">Agenda da semana</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {activeCount} {activeCount === 1 ? "atendimento" : "atendimentos"} de {shortISO(weekStart)} a {shortISO(weekEnd)}
            </p>
          </div>
          <NewBookingDialog defaultDate={date} services={data.services} professionals={data.pros} fullAccess={plan.tier === "completo"} />
        </header>

        <AgendaToolbar
          view="semana"
          date={weekStart}
          today={today}
          status="all"
          professionalId={prof}
          pendingMode={false}
          professionals={data.pros}
          showCancelled={showCancelled}
        />

        <WeekGrid
          weekStart={weekStart}
          today={today}
          bookings={data.list}
          sessionLabel={data.sessionLabel}
          blocks={data.blocks}
          hours={data.hours}
          slotStep={(business as { slot_step_min?: number }).slot_step_min ?? 30}
          professionals={data.pros}
          showProfessionalColors={wholeTeam && prof === "all" && data.pros.length > 1}
          selectedProfessional={prof === "all" ? null : prof}
          services={data.services}
          canEdit={role !== "viewer"}
          fullAccess={plan.tier === "completo"}
          businessName={business.name}
          slug={business.slug}
          reschedule={data.reschedule}
        />
      </main>
    );
  }

  // ------------------------- VISÃO DIA -------------------------
  const status = STATUSES.includes(searchParams.status ?? "") ? searchParams.status! : "all";
  // "Pendentes" sem data escolhida = todos os pedidos pendentes a partir de hoje
  const pendingMode = status === "pending" && !searchParams.data;

  const { list, sessionLabel, services, pros, blocks, reschedule } = await loadAgenda(ctx, wholeTeam, {
    from: pendingMode ? today : date,
    to: date,
    status,
    prof,
    pendingMode,
  });
  const dayBlocks = pendingMode ? [] : blocks.filter((k) => blockAppliesOn(k, date));

  // agrupa por dia (só faz diferença no modo "pendentes")
  const byDay = list.reduce<Record<string, typeof list>>((acc, b) => {
    (acc[b.booking_date] ??= []).push(b);
    return acc;
  }, {});

  const activeCount = list.filter((b) => b.status !== "cancelled").length;
  // sessão de pacote já foi paga na venda: não entra no previsto do dia
  const expected = list
    .filter((b) => b.status !== "cancelled" && !b.customer_package_id)
    .reduce((s, b) => s + Number(b.price), 0);

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
        <NewBookingDialog defaultDate={date} services={services} professionals={pros} fullAccess={plan.tier === "completo"} />
      </header>

      <ViewPreference view={view} />

      <AgendaToolbar
        view="dia"
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
                      {b.customer_id ? (
                        <Link href={`/admin/clientes/${b.customer_id}`} className="font-semibold hover:underline" data-testid={`link-cliente-${b.id}`}>
                          {b.customer_name}
                        </Link>
                      ) : (
                        <p className="font-semibold">{b.customer_name}</p>
                      )}
                      <StatusBadge status={b.status} />
                      <AutoConfirmBadge status={b.status} reason={b.auto_confirm_reason} testId={`selo-auto-confirmado-${b.id}`} />
                      {b.series_id && (
                        <span
                          className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-primary"
                          data-testid={`selo-recorrente-${b.id}`}
                        >
                          <Repeat className="h-3 w-3" /> Recorrente
                        </span>
                      )}
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <Globe className="h-3 w-3" /> {SOURCE[b.source] ?? b.source}
                      </span>
                    </div>
                    <p className="text-sm">
                      {b.service_name} com {b.professional_name}
                      {b.customer_package_id ? (
                        <span
                          className="ml-2 inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-primary"
                          data-testid={`selo-pacote-${b.id}`}
                        >
                          <Package className="h-3 w-3" /> {sessionLabel[b.id] ?? "Pacote"}
                        </span>
                      ) : (
                        <span className="text-muted-foreground"> · {brl(b.price)}</span>
                      )}
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
                  <BookingActions booking={b} businessName={business.name} slug={business.slug} fullAccess={plan.tier === "completo"} reschedule={reschedule} />
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </main>
  );
}
