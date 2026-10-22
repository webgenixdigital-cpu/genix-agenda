import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getAdminContext } from "@/lib/admin";
import { getPlanContext } from "@/lib/plan";
import { getOnboarding } from "@/lib/onboarding";
import { OnboardingCard } from "@/components/admin/onboarding-card";
import { monthStartISO, todayISO } from "@/lib/dates";
import { brl, longDate } from "@/lib/format";
import { StatusBadge } from "@/components/admin/status-badge";
import { VitrineLinkCard } from "@/components/admin/vitrine-link-card";
import { Button } from "@/components/ui/button";
import type { BookingStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------
// PARTE 1 — Dados
// ---------------------------------------------------------------------
async function loadDashboard(businessId: string) {
  const supabase = createClient();
  const today = todayISO();
  const monthStart = monthStartISO();

  const [bookingsToday, cashMonth, pendingCount, doneMonth] = await Promise.all([
    supabase
      .from("bookings")
      .select("id, start_time, end_time, customer_name, service_name, professional_name, price, status, source")
      .eq("business_id", businessId)
      .eq("booking_date", today)
      .order("start_time"),
    supabase
      .from("cash_entries")
      .select("kind, amount, entry_date")
      .eq("business_id", businessId)
      .gte("entry_date", monthStart)
      .lte("entry_date", today),
    supabase
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .eq("business_id", businessId)
      .eq("status", "pending")
      .gte("booking_date", today),
    // atendimentos concluídos no mês (o banco já limita ao que cada papel pode ver)
    supabase
      .from("bookings")
      .select("price")
      .eq("business_id", businessId)
      .eq("status", "completed")
      .gte("booking_date", monthStart)
      .lte("booking_date", today),
  ]);

  const cash = cashMonth.data ?? [];
  const incomes = cash.filter((c) => c.kind === "income");
  const sum = (list: { amount: number }[]) => list.reduce((acc, c) => acc + Number(c.amount), 0);

  const revenueMonth = sum(incomes);
  const revenueToday = sum(incomes.filter((c) => c.entry_date === today));
  const expensesMonth = sum(cash.filter((c) => c.kind === "expense"));
  const avgTicket = incomes.length ? revenueMonth / incomes.length : 0;

  const list = bookingsToday.data ?? [];
  const activeToday = list.filter((b) => b.status !== "cancelled");

  return {
    today,
    bookings: list,
    stats: {
      revenueToday,
      revenueMonth,
      expensesMonth,
      avgTicket,
      bookingsToday: activeToday.length,
      expectedToday: sum(activeToday.map((b) => ({ amount: b.price }))),
      pending: pendingCount.count ?? 0,
      doneMonthCount: (doneMonth.data ?? []).length,
      doneMonthValue: sum((doneMonth.data ?? []).map((b) => ({ amount: b.price }))),
      doneToday: list.filter((b) => b.status === "completed").length,
    },
  };
}

// ---------------------------------------------------------------------
// PARTE 2 — Página
// ---------------------------------------------------------------------
type Props = { searchParams: { "bem-vindo"?: string } };

export default async function Dashboard({ searchParams }: Props) {
  const { business, role, professionalId } = await getAdminContext();
  const plan = await getPlanContext(business.id);
  const isOwner = role === "owner";
  const supabase = createClient();
  const { data: me } = professionalId
    ? await supabase.from("professionals").select("name, commission_pct").eq("id", professionalId).maybeSingle()
    : { data: null };
  const [{ today, bookings, stats }, onboarding] = await Promise.all([
    loadDashboard(business.id),
    plan.internal || !isOwner ? Promise.resolve(null) : getOnboarding(business as never, plan),
  ]);
  const welcome = searchParams["bem-vindo"] === "1";

  // Indicadores por papel
  const commission = Number(me?.commission_pct ?? 0);
  const cards =
    role === "staff"
      ? [
          { label: "Meus atendimentos hoje", value: String(stats.bookingsToday), hint: `${brl(stats.expectedToday)} previstos` },
          { label: "Concluídos hoje", value: String(stats.doneToday), hint: "atendimentos finalizados" },
          { label: "Concluídos no mês", value: String(stats.doneMonthCount), hint: `${brl(stats.doneMonthValue)} em serviços` },
          {
            label: "Comissão estimada",
            value: brl((stats.doneMonthValue * commission) / 100),
            hint: commission ? `${String(commission).replace(".", ",")}% no mês` : "percentual não definido",
          },
        ]
      : role === "reception"
        ? [
            { label: "Atendimentos hoje", value: String(stats.bookingsToday), hint: "toda a equipe" },
            { label: "Previsto hoje", value: brl(stats.expectedToday), hint: "na agenda" },
            { label: "Concluídos hoje", value: String(stats.doneToday), hint: "atendimentos finalizados" },
            { label: "Pedidos pendentes", value: String(stats.pending), hint: "aguardando confirmação" },
          ]
        : [
            { label: "Faturamento hoje", value: brl(stats.revenueToday), hint: `${brl(stats.expectedToday)} previstos na agenda` },
            { label: "Faturamento do mês", value: brl(stats.revenueMonth), hint: `Saldo ${brl(stats.revenueMonth - stats.expensesMonth)}` },
            { label: "Atendimentos hoje", value: String(stats.bookingsToday), hint: "sem contar cancelados" },
            { label: "Ticket médio", value: brl(stats.avgTicket), hint: "no mês" },
          ];
  const greeting = role === "staff" && me?.name ? me.name.split(" ")[0] : business.name;

  return (
    <main className="mx-auto max-w-6xl space-y-8 p-4 md:p-8">
      <header>
        <p className="text-sm text-muted-foreground first-letter:uppercase">{longDate(today)}</p>
        <h1 className="mt-1 text-3xl md:text-4xl">Olá, {greeting}</h1>
      </header>

      {onboarding && (
        <OnboardingCard
          items={onboarding.items}
          doneCount={onboarding.doneCount}
          total={onboarding.total}
          dismissed={onboarding.dismissed}
          slug={business.slug}
          welcome={welcome}
          ownerName={(business as { owner_name?: string | null }).owner_name}
        />
      )}

      {stats.pending > 0 && (
        <Link
          href="/admin/agenda?status=pending"
          className="flex items-center justify-between gap-4 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-amber-900 transition-colors hover:bg-amber-100"
          data-testid="alerta-pendentes"
        >
          <span>
            <strong>{stats.pending}</strong>{" "}
            {stats.pending === 1 ? "pedido aguardando sua confirmação" : "pedidos aguardando sua confirmação"}
          </span>
          <span className="text-sm font-semibold underline">Confirmar agora</span>
        </Link>
      )}

      {/* Indicadores */}
      <section className="grid grid-cols-2 gap-4 md:gap-6 lg:grid-cols-4">
        {cards.map((c) => (
          <div key={c.label} className="rounded-2xl border bg-card p-4 md:p-5">
            <p className="text-sm text-muted-foreground">{c.label}</p>
            <p className="mt-2 font-heading text-2xl md:text-3xl">{c.value}</p>
            <p className="mt-1 text-xs text-muted-foreground">{c.hint}</p>
          </div>
        ))}
      </section>

      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        {/* Agenda de hoje */}
        <section className="rounded-2xl border bg-card">
          <div className="flex items-center justify-between border-b p-5">
            <h2 className="font-sans text-base font-semibold">Agenda de hoje</h2>
            <Button asChild variant="outline" size="sm">
              <Link href="/admin/agenda">Abrir agenda</Link>
            </Button>
          </div>

          {bookings.length === 0 ? (
            <p className="p-8 text-center text-muted-foreground">
              Nenhum atendimento hoje. Compartilhe o link da vitrine para receber agendamentos.
            </p>
          ) : (
            <ul className="divide-y">
              {bookings.map((b) => (
                <li key={b.id} className="flex items-center gap-4 p-4 md:px-5" data-testid={`agenda-hoje-${b.id}`}>
                  <div className="w-14 shrink-0 text-center">
                    <p className="font-semibold">{b.start_time.slice(0, 5)}</p>
                    <p className="text-xs text-muted-foreground">{b.end_time.slice(0, 5)}</p>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{b.customer_name}</p>
                    <p className="truncate text-sm text-muted-foreground">
                      {b.service_name} com {b.professional_name}
                    </p>
                  </div>
                  <StatusBadge status={b.status as BookingStatus} />
                </li>
              ))}
            </ul>
          )}
        </section>

        <VitrineLinkCard slug={business.slug} />
      </div>
    </main>
  );
}
