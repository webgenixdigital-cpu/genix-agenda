import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Ajuda } from "@/components/ajuda";
import { requireRoles } from "@/lib/admin";
import { createClient } from "@/lib/supabase/server";
import { addDaysISO, todayInZone } from "@/lib/dates";
import { longDate } from "@/lib/format";
import { PET_NICHE_ID, type RouteStatus } from "@/lib/pets";
import { RoutesBoard, type RouteGroup, type DriverRow } from "@/components/admin/leva-e-traz/routes-board";
import { DriversCard } from "@/components/admin/leva-e-traz/drivers-card";

export const dynamic = "force-dynamic";

type Props = { searchParams: { data?: string } };

const shortDay = (iso: string) =>
  new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", weekday: "short", day: "2-digit", month: "2-digit" }).format(new Date(`${iso}T12:00:00Z`));

type Row = {
  id: string;
  kind: "busca" | "entrega";
  status: RouteStatus;
  stop_order: number | null;
  driver_id: string | null;
  booking: {
    id: string;
    booking_date: string;
    start_time: string;
    end_time: string;
    status: string;
    customer_id: string | null;
    customer_name: string;
    customer_phone: string;
    customer_phone_country: string | null;
    transport_fee: number | null;
    customer: { address: string | null; address_ref: string | null } | null;
    pet: { name: string } | null;
  };
};

// ---------------------------------------------------------------------
// 4b — Leva e traz do dia (banho e tosa): matriz e recepção gerenciam; demo só vê
// ---------------------------------------------------------------------
export default async function LevaETrazPage({ searchParams }: Props) {
  const { business, role } = await requireRoles(["owner", "reception", "viewer"]);
  if (business.subcategory !== PET_NICHE_ID) redirect("/admin");

  const today = todayInZone(business.timezone);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.data ?? "") ? searchParams.data! : today;
  const supabase = createClient();

  // 1) agendamentos do dia com leva e traz; 2) as paradas deles (sem filtro em tabela ligada)
  const [{ data: dayBookings }, { data: drivers }, { data: upcoming }] = await Promise.all([
    supabase
      .from("bookings").select("id")
      .eq("business_id", business.id).eq("booking_date", date)
      .neq("transport", "nenhum").neq("status", "cancelled"),
    supabase.from("business_drivers").select("id, name, phone, active").eq("business_id", business.id).order("name"),
    // próximos 30 dias com leva e traz (atalhos quando o dia está vazio)
    supabase
      .from("bookings").select("booking_date")
      .eq("business_id", business.id).neq("transport", "nenhum").neq("status", "cancelled")
      .gte("booking_date", today).lte("booking_date", addDaysISO(today, 30))
      .order("booking_date").limit(200),
  ]);
  const ids = (dayBookings ?? []).map((b) => b.id as string);
  const { data: rows } = ids.length
    ? await supabase
        .from("transport_routes")
        .select(
          "id, kind, status, stop_order, driver_id, booking:bookings(id, booking_date, start_time, end_time, status, customer_id, customer_name, customer_phone, customer_phone_country, transport_fee, customer:customers(address, address_ref), pet:pets(name))"
        )
        .eq("business_id", business.id)
        .in("booking_id", ids)
    : { data: [] };

  const nextDays = new Map<string, number>();
  for (const u of upcoming ?? []) {
    const d = u.booking_date as string;
    if (d !== date) nextDays.set(d, (nextDays.get(d) ?? 0) + 1);
  }

  // mesmo tutor, mesmo horário e mesmo tipo = uma parada só (vários pets no mesmo carro)
  const groups = new Map<string, RouteGroup>();
  for (const r of (rows ?? []) as unknown as Row[]) {
    const b = r.booking;
    const key = `${r.kind}|${b.customer_id ?? b.id}|${b.start_time}`;
    const g = groups.get(key) ?? {
      key,
      routeIds: [],
      kind: r.kind,
      status: r.status,
      order: r.stop_order,
      driverId: r.driver_id,
      time: (r.kind === "busca" ? b.start_time : b.end_time).slice(0, 5),
      bookingStart: b.start_time.slice(0, 5),
      tutor: b.customer_name,
      phone: b.customer_phone,
      phoneCountry: b.customer_phone_country,
      customerId: b.customer_id,
      address: b.customer?.address ?? null,
      addressRef: b.customer?.address_ref ?? null,
      pets: [],
      fee: 0,
    };
    g.routeIds.push(r.id);
    if (b.pet?.name && !g.pets.includes(b.pet.name)) g.pets.push(b.pet.name);
    g.fee += Number(b.transport_fee ?? 0);
    if (g.order === null || (r.stop_order !== null && r.stop_order < g.order)) g.order = r.stop_order;
    groups.set(key, g);
  }
  // ordem salva primeiro; sem ordem, pelo horário (buscas antes das entregas)
  const list = Array.from(groups.values()).sort(
    (a, b) =>
      (a.order ?? 9999) - (b.order ?? 9999) ||
      (a.kind === b.kind ? 0 : a.kind === "busca" ? -1 : 1) ||
      a.time.localeCompare(b.time)
  );

  const canManage = role === "owner" || role === "reception";
  const nav = (d: string) => `/admin/leva-e-traz${d === today ? "" : `?data=${d}`}`;

  return (
    <main className="mx-auto max-w-3xl space-y-8 p-4 md:p-8">
      <header className="text-center">
        <h1 className="text-3xl md:text-4xl">Leva e traz <Ajuda id="leva-e-traz" className="-ml-2" /></h1>
        <p className="mx-auto mt-1 max-w-lg text-sm text-muted-foreground">
          Buscas e entregas do dia. Escolha o motorista e a ordem da rota; o status atualiza sozinho.
        </p>
      </header>

      <nav className="flex items-center justify-center gap-2" aria-label="Dia">
        <Link href={nav(addDaysISO(date, -1))} className="inline-flex h-11 w-11 items-center justify-center rounded-lg border bg-white"
          aria-label="Dia anterior" data-testid="btn-dia-anterior">
          <ChevronLeft className="h-5 w-5" />
        </Link>
        <p className="min-w-48 text-center font-semibold capitalize">{date === today ? "Hoje" : longDate(date)}</p>
        <Link href={nav(addDaysISO(date, 1))} className="inline-flex h-11 w-11 items-center justify-center rounded-lg border bg-white"
          aria-label="Próximo dia" data-testid="btn-dia-seguinte">
          <ChevronRight className="h-5 w-5" />
        </Link>
      </nav>

      <RoutesBoard businessId={business.id} groups={list} drivers={(drivers ?? []) as DriverRow[]} canManage={canManage} />

      {list.length === 0 && nextDays.size > 0 && (
        <section className="space-y-2" data-testid="proximos-leva-traz">
          <h2 className="font-sans text-sm font-semibold text-muted-foreground">Próximos dias com leva e traz</h2>
          <div className="flex flex-wrap gap-2">
            {Array.from(nextDays.entries()).slice(0, 10).map(([d, n]) => (
              <Link key={d} href={nav(d)} className="inline-flex min-h-11 items-center rounded-full border bg-white px-4 text-sm font-medium hover:bg-secondary"
                data-testid={`atalho-dia-${d}`}>
                {shortDay(d)} · {n} {n === 1 ? "agendamento" : "agendamentos"}
              </Link>
            ))}
          </div>
        </section>
      )}

      {role === "owner" && <DriversCard drivers={(drivers ?? []) as DriverRow[]} />}
    </main>
  );
}
