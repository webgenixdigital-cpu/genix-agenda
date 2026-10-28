// Dados da Agenda (visões Dia e Semana). SÓ SERVIDOR: usa o cliente da sessão,
// então a RLS decide o que cada papel vê (profissional = só a própria agenda).
import { createClient } from "@/lib/supabase/server";
import type { AdminContext } from "@/lib/admin";
import { todayISO } from "@/lib/dates";
import type { RescheduleProps } from "@/components/admin/agenda/booking-actions";
import type { AgendaBlock, AgendaHour, AgendaItem } from "@/lib/agenda";

export { blockAppliesOn } from "@/lib/agenda";

type Options = {
  from: string; // yyyy-mm-dd
  to: string; // yyyy-mm-dd (inclusivo)
  status: string; // "all" | status
  prof: string; // "all" | professional_id
  pendingMode?: boolean; // "Pendentes": todos a partir de `from`
  withHours?: boolean; // visão Semana precisa do expediente
  hideCancelled?: boolean; // visão Semana sem "Mostrar cancelados"
};

const NO_ONE = "00000000-0000-0000-0000-000000000000";

/** Profissional que o filtro usa: staff sempre o próprio */
export function agendaProfessional(wholeTeam: boolean, requested: string | undefined, own: string | null) {
  return wholeTeam ? requested ?? "all" : own ?? NO_ONE;
}

export async function loadAgenda(ctx: AdminContext, wholeTeam: boolean, o: Options) {
  const { business, role, professionalId } = ctx;
  const supabase = createClient();

  let q = supabase
    .from("bookings")
    .select("id, booking_date, start_time, end_time, customer_name, customer_phone, customer_notes, customer_id, service_name, professional_name, professional_id, service_id, price, status, source, customer_package_id, series_id")
    .eq("business_id", business.id)
    .order("booking_date")
    .order("start_time");
  q = o.pendingMode ? q.gte("booking_date", o.from) : q.gte("booking_date", o.from).lte("booking_date", o.to);
  if (o.status !== "all") q = q.eq("status", o.status);
  if (o.hideCancelled) q = q.neq("status", "cancelled");
  if (o.prof !== "all") q = q.eq("professional_id", o.prof);

  const [{ data: bookings }, { data: services }, { data: professionals }, { data: blocks }, { data: hours }] =
    await Promise.all([
      q,
      supabase.from("services").select("id, name, price, duration_min")
        .eq("business_id", business.id).eq("active", true).order("sort_order"),
      supabase.from("professionals").select("id, name")
        .eq("business_id", business.id).eq("active", true).order("sort_order"),
      o.pendingMode
        ? Promise.resolve({ data: [] })
        : supabase.from("schedule_blocks")
            .select("professional_id, date_start, date_end, time_start, time_end, reason, recurring, weekdays")
            .eq("business_id", business.id).lte("date_start", o.to).gte("date_end", o.from),
      o.withHours
        ? supabase.from("business_hours").select("weekday, open_time, close_time, closed").eq("business_id", business.id)
        : Promise.resolve({ data: [] }),
    ]);

  const list = (bookings ?? []) as AgendaItem[];

  // sessões de pacote: "Pacote 3/10"
  const packageIds = list.filter((b) => b.customer_package_id).map((b) => b.id);
  const { data: pkgInfo } = packageIds.length
    ? await supabase.rpc("booking_package_info", { p_business: business.id, p_bookings: packageIds })
    : { data: [] };
  const sessionLabel: Record<string, string> = Object.fromEntries(
    ((pkgInfo ?? []) as { booking_id: string; session_no: number; sessions_total: number }[]).map((i) => [
      i.booking_id,
      `Pacote ${i.session_no}/${i.sessions_total}`,
    ])
  );

  const pros = (professionals ?? []).filter((p) => wholeTeam || p.id === professionalId);

  // remarcar: profissionais com os serviços que fazem (sem vínculo = fazem todos)
  const { data: links } = await supabase
    .from("professional_services")
    .select("professional_id, service_id")
    .in("professional_id", pros.map((p) => p.id));
  const reschedule: RescheduleProps = {
    professionals: pros.map((p) => {
      const ids = (links ?? []).filter((l) => l.professional_id === p.id).map((l) => l.service_id as string);
      return { id: p.id, name: p.name, serviceIds: ids.length ? ids : null };
    }),
    canChooseProfessional: role === "owner" || role === "reception",
    today: todayISO(),
  };

  return {
    list,
    sessionLabel,
    services: services ?? [],
    pros,
    blocks: (blocks ?? []) as AgendaBlock[],
    hours: (hours ?? []) as AgendaHour[],
    reschedule,
  };
}
