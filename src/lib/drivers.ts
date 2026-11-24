// 4b — Escolha automática do motorista do leva e traz (servidor; respeita o RLS de quem chama)
import type { createClient } from "@/lib/supabase/server";

type Supa = ReturnType<typeof createClient>;

export type ActiveDriver = { id: string; name: string };

export async function activeDrivers(supabase: Supa, businessId: string): Promise<ActiveDriver[]> {
  const { data } = await supabase
    .from("business_drivers").select("id, name").eq("business_id", businessId).eq("active", true).order("name");
  return (data ?? []) as ActiveDriver[];
}

/**
 * Motorista para a parada: o escolhido (se ativo); senão, com 1 ativo, ele;
 * com vários, o primeiro sem outra parada no mesmo dia e horário (livre); senão o primeiro.
 */
export async function pickDriver(
  supabase: Supa,
  businessId: string,
  booking: { id: string; booking_date: string; start_time: string },
  chosen?: string | null
): Promise<string | null> {
  const drivers = await activeDrivers(supabase, businessId);
  if (drivers.length === 0) return null;
  if (chosen && drivers.some((d) => d.id === chosen)) return chosen;
  if (drivers.length === 1) return drivers[0].id;

  const { data: sameTime } = await supabase
    .from("bookings").select("id")
    .eq("business_id", businessId).eq("booking_date", booking.booking_date).eq("start_time", booking.start_time)
    .neq("id", booking.id).neq("transport", "nenhum").neq("status", "cancelled");
  const ids = (sameTime ?? []).map((b) => b.id as string);
  const busy = new Set<string>();
  if (ids.length) {
    const { data: r } = await supabase.from("transport_routes").select("driver_id").in("booking_id", ids);
    for (const x of r ?? []) if (x.driver_id) busy.add(x.driver_id as string);
  }
  return (drivers.find((d) => !busy.has(d.id)) ?? drivers[0]).id;
}
