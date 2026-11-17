// Dados do Início (/admin): tudo numa rodada só (um Promise.all), cada consulta
// só para o papel/plano que vê o quadro. Consulta que falha devolve null e o quadro some.
import { createClient } from "@/lib/supabase/server";
import { addDaysISO, todayInZone } from "@/lib/dates";
import { BIRTH_YEAR } from "@/lib/birthday";
import { nextHoliday, type Holiday } from "@/lib/holidays";
import { buildOnboarding, loadOnboardingCounts, setupGaps, type SetupGap } from "@/lib/onboarding";
import { loadFiscal } from "@/lib/faturamento-data";
import { loadPendingPayments } from "@/lib/agenda-data";
import { defaultProviderName } from "@/lib/whatsapp/provider";
import type { AdminContext } from "@/lib/admin";
import type { PlanContext } from "@/lib/plan";

type BusinessLike = {
  id: string;
  slug: string;
  timezone: string | null;
  description?: string | null;
  hero_image?: string | null;
  whatsapp?: string | null;
  onboarding?: Record<string, boolean> | null;
};

export type TodayBooking = {
  id: string;
  start_time: string;
  end_time: string;
  customer_name: string;
  service_name: string;
  professional_name: string;
  price: number;
  status: string;
};

export type NextBlock = { date_start: string; date_end: string; reason: string | null; time_start: string | null };
export type BirthdayItem = { id: string; name: string; birth_date: string; inDays: number };
export type WhatsappTile = { status: "unknown" | "connected" | "disconnected"; autoEnabled: boolean; sentToday: number };

const none = Promise.resolve(null);

/** Instante (ISO) da meia-noite de hoje no fuso do espaço */
function dayStartISO(timeZone: string) {
  const now = new Date();
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(now);
  } catch {
    parts = new Intl.DateTimeFormat("en-GB", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(now);
  }
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const elapsed = ((n("hour") * 60 + n("minute")) * 60 + n("second")) * 1000 + now.getMilliseconds();
  return new Date(now.getTime() - elapsed).toISOString();
}

/** Dias até o próximo aniversário (dia/mês) a partir de hoje, no calendário do ano 2000 */
function daysUntilBirthday(birth: string, today: string) {
  const base = `${BIRTH_YEAR}-${today.slice(5)}`;
  const target = `${BIRTH_YEAR}-${birth.slice(5)}`;
  const diff = (Date.parse(`${target}T12:00:00Z`) - Date.parse(`${base}T12:00:00Z`)) / 86_400_000;
  return diff >= 0 ? Math.round(diff) : Math.round(diff + 366);
}

export async function loadHome(
  ctx: Pick<AdminContext, "role" | "professionalId">,
  business: BusinessLike,
  // o plano entra na mesma rodada: as consultas não esperam por ele, só a montagem dos quadros
  planPromise: Promise<PlanContext>
) {
  const supabase = createClient();
  const { role, professionalId } = ctx;
  const tz = business.timezone || "America/Sao_Paulo";
  const today = todayInZone(tz);
  const monthStart = today.slice(0, 8) + "01";
  const bid = business.id;

  const ownerLike = role === "owner" || role === "viewer";
  const wholeTeam = ownerLike || role === "reception";

  // aniversários: birth_date guarda o ano 2000; na virada do ano são duas faixas
  const bStart = `${BIRTH_YEAR}-${today.slice(5)}`;
  const bEnd = `${BIRTH_YEAR}-${addDaysISO(today, 7).slice(5)}`;
  const birthdayRange =
    bStart <= bEnd
      ? `and(birth_date.gte.${bStart},birth_date.lte.${bEnd})`
      : `and(birth_date.gte.${bStart},birth_date.lte.${BIRTH_YEAR}-12-31),and(birth_date.gte.${BIRTH_YEAR}-01-01,birth_date.lte.${bEnd})`;

  let blocksQuery = supabase
    .from("schedule_blocks")
    .select("date_start, date_end, reason, time_start")
    .eq("business_id", bid)
    .eq("recurring", false)
    .gte("date_end", today)
    .order("date_start")
    .limit(1);
  if (!wholeTeam && professionalId) blocksQuery = blocksQuery.or(`professional_id.is.null,professional_id.eq.${professionalId}`);

  const [
    plan,
    me,
    bookingsToday,
    pendingConfirm,
    autoConfirmed,
    cashMonth,
    doneMonth,
    pendingPayments,
    waPanel,
    waSent,
    birthdays,
    returns,
    nextBlock,
    counts,
    fiscal,
  ] = await Promise.all([
    planPromise,
    professionalId
      ? supabase.from("professionals").select("name, commission_pct").eq("id", professionalId).maybeSingle()
      : none,
    supabase
      .from("bookings")
      .select("id, start_time, end_time, customer_name, service_name, professional_name, price, status")
      .eq("business_id", bid)
      .eq("booking_date", today)
      .order("start_time"),
    supabase
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .eq("business_id", bid)
      .eq("status", "pending")
      .gte("booking_date", today),
    wholeTeam
      ? supabase
          .from("bookings")
          .select("id", { count: "exact", head: true })
          .eq("business_id", bid)
          .eq("source", "online")
          .eq("status", "confirmed")
          .not("auto_confirm_reason", "is", null)
          .gte("created_at", new Date(Date.now() - 86_400_000).toISOString())
      : none,
    ownerLike
      ? supabase.from("cash_entries").select("kind, amount").eq("business_id", bid).gte("entry_date", monthStart).lte("entry_date", today)
      : none,
    // staff: concluídos no mês para "Meus ganhos" (o banco já limita aos dele)
    role === "staff"
      ? supabase
          .from("bookings")
          .select("price")
          .eq("business_id", bid)
          .eq("status", "completed")
          .gte("booking_date", monthStart)
          .lte("booking_date", today)
      : none,
    loadPendingPayments(bid),
    ownerLike ? supabase.rpc("whatsapp_panel_status", { p_business: bid }) : none,
    ownerLike
      ? supabase
          .from("whatsapp_reminder_sends")
          .select("id", { count: "exact", head: true })
          .eq("business_id", bid)
          .eq("status", "sent")
          .gte("sent_at", dayStartISO(tz))
      : none,
    wholeTeam
      ? supabase.from("customers").select("id, name, birth_date").eq("business_id", bid).or(birthdayRange).limit(50)
      : none,
    wholeTeam ? supabase.rpc("return_queue", { p_business: bid }) : none,
    blocksQuery,
    ownerLike ? loadOnboardingCounts(bid) : none,
    ownerLike ? loadFiscal(bid) : none,
  ]);

  // Grátis: sem caixa, retornos, WhatsApp automático nem bloqueios (as consultas rodaram juntas; aqui só escondemos)
  const paid = plan.tier === "completo";
  const sum = (list: { amount: number | string }[]) => list.reduce((acc, c) => acc + Number(c.amount), 0);

  // --- Hoje
  const bookings = (bookingsToday.data ?? []) as TodayBooking[];
  const active = bookings.filter((b) => b.status !== "cancelled");

  // --- Caixa do mês
  const cash = paid ? (cashMonth?.data ?? null) : null;
  const cashTile = cash
    ? {
        income: sum(cash.filter((c) => c.kind === "income")),
        expense: sum(cash.filter((c) => c.kind === "expense")),
      }
    : null;

  // --- WhatsApp: mesmo critério de Configurações para mostrar o cartão
  const wa = (waPanel && !waPanel.error ? waPanel.data : null) as
    | { status?: WhatsappTile["status"]; genix_enabled?: boolean; provider?: string | null; has_instance?: boolean; auto_enabled?: boolean }
    | null;
  const waEvolution =
    !!wa && (wa.provider === "evolution" || (defaultProviderName() === "evolution" && !(wa.provider === "zapi" && wa.has_instance)));
  const whatsapp: WhatsappTile | null =
    paid && wa && (waEvolution || wa.genix_enabled)
      ? { status: wa.status ?? "unknown", autoEnabled: !!wa.auto_enabled, sentToday: waSent?.count ?? 0 }
      : null;

  // --- Aniversários (próximos 7 dias, o mais perto primeiro)
  const birthdayList: BirthdayItem[] | null =
    birthdays && !birthdays.error
      ? ((birthdays.data ?? []) as { id: string; name: string; birth_date: string }[])
          .map((c) => ({ ...c, inDays: daysUntilBirthday(c.birth_date, today) }))
          .filter((c) => c.inDays <= 7)
          .sort((a, b) => a.inDays - b.inDays || a.name.localeCompare(b.name, "pt-BR"))
      : null;

  // --- Retornos: fila "Hora de voltar" sem contato ainda
  const returnRows =
    paid && returns && !returns.error ? ((returns.data ?? []) as { days_overdue: number; return_contacted_at: string | null }[]) : null;
  const returnsTile = returnRows
    ? (() => {
        const queue = returnRows.filter((r) => !r.return_contacted_at);
        return { due: queue.filter((r) => r.days_overdue >= 0).length, soon: queue.filter((r) => r.days_overdue < 0).length };
      })()
    : null;

  // --- Próximo bloqueio ou feriado nacional (o que vier antes)
  const block = (paid && !nextBlock.error ? (nextBlock.data?.[0] ?? null) : null) as NextBlock | null;
  const holiday: Holiday | null = nextHoliday(today);

  // --- Falta configurar (dono)
  const gaps: SetupGap[] | null = counts
    ? setupGaps(business, counts, fiscal && paid ? (fiscal.regime ?? null) : undefined)
    : null;
  const onboarding = counts ? buildOnboarding(business, plan, counts) : null;

  // --- Meus ganhos (staff)
  const commission = Number((me?.data as { commission_pct?: number | null } | null)?.commission_pct ?? 0);
  const doneValue = sum(((doneMonth?.data ?? []) as { price: number }[]).map((b) => ({ amount: b.price })));
  const pending = paid ? pendingPayments : null;

  return {
    plan,
    today,
    meName: (me?.data as { name?: string } | null)?.name ?? null,
    bookings,
    todayTile: {
      count: active.length,
      done: bookings.filter((b) => b.status === "completed").length,
      pendingConfirm: pendingConfirm.count ?? 0,
    },
    autoConfirmed: autoConfirmed?.count ?? 0,
    payments: pending ? { count: pending.length, total: pending.reduce((a, p) => a + p.amount, 0) } : null,
    whatsapp,
    birthdays: birthdayList,
    returns: returnsTile,
    block,
    holiday,
    gaps,
    onboarding,
    cash: cashTile,
    earnings: role === "staff" ? { value: (doneValue * commission) / 100, commission, count: (doneMonth?.data ?? []).length } : null,
  };
}

export type HomeData = Awaited<ReturnType<typeof loadHome>>;
