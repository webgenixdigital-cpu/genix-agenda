import Link from "next/link";
import { CalendarDays } from "lucide-react";
import { getAdminContext, seesWholeTeam } from "@/lib/admin";
import { getPlanContext } from "@/lib/plan";
import { addDaysISO, mondayOf, todayInZone } from "@/lib/dates";
import { agendaProfessional, blockAppliesOn, loadAgenda } from "@/lib/agenda-data";
import { monthOf, monthRange, monthTitle } from "@/lib/agenda";
import { brl, longDate } from "@/lib/format";
import { AgendaToolbar } from "@/components/admin/agenda/agenda-toolbar";
import { BlockNotice, BookingCard } from "@/components/admin/agenda/booking-card";
import { MobileCalendar, MonthCalendar } from "@/components/admin/agenda/month-calendar";
import { ViewPreference } from "@/components/admin/agenda/view-preference";
import { WeekGrid } from "@/components/admin/agenda/week-grid";
import { NewBookingDialog } from "@/components/admin/agenda/new-booking-dialog";

export const dynamic = "force-dynamic";

type Props = {
  searchParams: { data?: string; status?: string; prof?: string; visao?: string; cancelados?: string; calendario?: string };
};

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

  // "hoje" no fuso do espaço (o servidor da Vercel roda em UTC)
  const today = todayInZone(business.timezone);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.data ?? "") ? searchParams.data! : today;
  const view = searchParams.visao === "semana" ? "semana" : searchParams.visao === "mes" ? "mes" : "dia";
  const prof = agendaProfessional(wholeTeam, searchParams.prof, professionalId);
  const showCancelled = searchParams.cancelados === "1";

  // ------------------------- VISÃO MÊS (md+) -------------------------
  if (view === "mes") {
    const month = monthOf(searchParams.data) ?? today.slice(0, 7);
    const data = await loadAgenda(ctx, wholeTeam, {
      ...monthRange(month),
      status: "all",
      prof,
      hideCancelled: !showCancelled,
    });
    const activeCount = data.list.filter((b) => b.status !== "cancelled" && b.booking_date.startsWith(month)).length;

    return (
      <main className="mx-auto max-w-screen-2xl space-y-8 p-4 md:p-8">
        <ViewPreference view={view} today={today} timeZone={business.timezone} />
        <header className="flex flex-col items-center gap-4 text-center">
          <div>
            <h1 className="text-3xl md:text-4xl">Agenda do mês</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {activeCount} {activeCount === 1 ? "atendimento" : "atendimentos"} em {monthTitle(month).replace(/ de \d+$/, "")}
            </p>
          </div>
          <NewBookingDialog defaultDate={month === today.slice(0, 7) ? today : `${month}-01`} services={data.services} professionals={data.pros} fullAccess={plan.tier === "completo"} canSellPackages={wholeTeam} />
        </header>

        <AgendaToolbar
          view="mes"
          date={month}
          today={today}
          status="all"
          professionalId={prof}
          pendingMode={false}
          professionals={data.pros}
          showCancelled={showCancelled}
        />

        <MonthCalendar
          month={month}
          today={today}
          bookings={data.list}
          sessionLabel={data.sessionLabel}
          blocks={data.blocks}
          services={data.services}
          professionals={data.pros}
          selectedProfessional={prof === "all" ? null : prof}
          fullAccess={plan.tier === "completo"}
          businessName={business.name}
          slug={business.slug}
          reschedule={data.reschedule}
        />
      </main>
    );
  }

  // ------------------------- VISÃO SEMANA -------------------------
  if (view === "semana") {
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
      <main className="mx-auto max-w-screen-2xl space-y-8 p-4 md:p-8">
        <ViewPreference view={view} today={today} timeZone={business.timezone} />
        <header className="flex flex-col items-center gap-4 text-center">
          <div>
            <h1 className="text-3xl md:text-4xl">Agenda da semana</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {activeCount} {activeCount === 1 ? "atendimento" : "atendimentos"} de {shortISO(weekStart)} a {shortISO(weekEnd)}
            </p>
          </div>
          <NewBookingDialog defaultDate={date} services={data.services} professionals={data.pros} fullAccess={plan.tier === "completo"} canSellPackages={wholeTeam} />
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
  // celular: calendário do mês em janela tela cheia (?calendario=yyyy-mm)
  const calMonth = monthOf(searchParams.calendario);

  const [{ list, sessionLabel, services, pros, blocks, reschedule }, monthData] = await Promise.all([
    loadAgenda(ctx, wholeTeam, {
      from: pendingMode ? today : date,
      to: date,
      status,
      prof,
      pendingMode,
      // cancelado sai da lista do dia (continua no banco, no histórico e nos relatórios);
      // para vê-los, filtro "Cancelados"
      hideCancelled: status === "all",
    }),
    calMonth
      ? loadAgenda(ctx, wholeTeam, { ...monthRange(calMonth), status: "all", prof, hideCancelled: !showCancelled })
      : Promise.resolve(null),
  ]);
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

  const calendarHref = (() => {
    const p = new URLSearchParams();
    if (searchParams.data) p.set("data", searchParams.data);
    if (searchParams.prof) p.set("prof", searchParams.prof);
    p.set("calendario", date.slice(0, 7));
    return `/admin/agenda?${p.toString()}`;
  })();

  // -------------------------------------------------------------------
  // PARTE 2 — Página
  // -------------------------------------------------------------------
  return (
    <main className="mx-auto max-w-5xl space-y-8 p-4 md:p-8">
      <header className="flex flex-col items-center gap-4 text-center">
        <div>
          <h1 className="text-3xl md:text-4xl">{pendingMode ? "Pedidos pendentes" : "Agenda"}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {pendingMode
              ? `${list.length} ${list.length === 1 ? "pedido aguardando" : "pedidos aguardando"} confirmação`
              : `${activeCount} ${activeCount === 1 ? "atendimento" : "atendimentos"}, ${brl(expected)} previstos`}
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <NewBookingDialog defaultDate={date} services={services} professionals={pros} fullAccess={plan.tier === "completo"} canSellPackages={wholeTeam} />
          <Link
            href={calendarHref}
            className="inline-flex h-11 items-center gap-2 rounded-md border bg-card px-4 text-sm font-semibold hover:bg-secondary md:hidden"
            data-testid="btn-calendario"
          >
            <CalendarDays className="h-4 w-4 text-primary" /> Calendário
          </Link>
        </div>
      </header>

      <ViewPreference view={view} today={today} timeZone={business.timezone} />

      <AgendaToolbar
        view="dia"
        date={date}
        today={today}
        status={status}
        professionalId={prof}
        pendingMode={pendingMode}
        professionals={pros}
      />

      <BlockNotice blocks={dayBlocks} professionals={pros} />

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
              <BookingCard
                key={b.id}
                booking={b}
                sessionLabel={sessionLabel[b.id]}
                businessName={business.name}
                slug={business.slug}
                fullAccess={plan.tier === "completo"}
                reschedule={reschedule}
              />
            ))}
          </ul>
        </section>
      ))}

      {calMonth && monthData && (
        <MobileCalendar
          month={calMonth}
          today={today}
          currentDate={date}
          bookings={monthData.list}
          sessionLabel={monthData.sessionLabel}
          blocks={monthData.blocks}
          services={monthData.services}
          professionals={monthData.pros}
          selectedProfessional={prof === "all" ? null : prof}
          professionalId={prof}
          showCancelled={showCancelled}
          fullAccess={plan.tier === "completo"}
          businessName={business.name}
          slug={business.slug}
          reschedule={monthData.reschedule}
        />
      )}
    </main>
  );
}
