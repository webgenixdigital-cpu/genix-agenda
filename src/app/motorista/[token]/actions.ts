"use server";

// 4c — App do motorista (link simples, sem login). Só chama as funções da 66,
// que conferem o código, o motorista ativo, a parada dele e o status permitido.
import { revalidatePath, unstable_noStore as noStore } from "next/cache";
import { createPublicClient } from "@/lib/supabase/public";
import type { DriverStop } from "@/components/motorista/driver-route";

const TOKEN = /^[0-9a-f]{48}$/;
const UUID = /^[0-9a-f-]{36}$/i;
const ALLOWED = ["a_caminho", "coletado", "na_loja", "saiu_entrega", "entregue"];

export async function driverSetStatus(token: string, routeIds: string[], status: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!TOKEN.test(token) || !routeIds.length || routeIds.length > 10 || !routeIds.every((id) => UUID.test(id)) || !ALLOWED.includes(status)) {
    return { ok: false, error: "Dados inválidos. Atualize a página." };
  }
  const db = createPublicClient();
  for (const id of routeIds) {
    const { error } = await db.rpc("driver_link_update", { p_token: token, p_route: id, p_status: status });
    if (error) {
      return {
        ok: false,
        error: error.message.includes("STATUS_INVALIDO") ? "Esse status não vale para esta parada." : "Link inválido ou parada não encontrada. Peça um link novo.",
      };
    }
  }
  revalidatePath(`/motorista/${token}`);
  return { ok: true };
}

type Row = {
  route_id: string;
  kind: "busca" | "entrega";
  status: string;
  stop_order: number | null;
  start_time: string;
  end_time: string;
  tutor_first_name: string;
  tutor_phone: string;
  tutor_phone_country: string | null;
  address: string | null;
  address_ref: string | null;
  pet_name: string | null;
  driver_name: string;
  business_name: string;
};

export type DriverData = { stops: DriverStop[]; driverName: string | null; businessName: string | null };

/** Paradas de hoje do motorista do link, sempre direto do banco (sem cache) */
export async function loadDriverStops(token: string): Promise<DriverData> {
  noStore();
  if (!TOKEN.test(token)) return { stops: [], driverName: null, businessName: null };
  const { data } = await createPublicClient().rpc("driver_link_routes", { p_token: token });
  const rows = (data ?? []) as Row[];

  // mesmo tutor, mesmo horário e mesmo tipo = uma parada só (vários pets no mesmo carro)
  const stops = new Map<string, DriverStop>();
  for (const r of rows) {
    const key = `${r.kind}|${r.tutor_phone}|${r.start_time}`;
    const s = stops.get(key) ?? {
      key,
      routeIds: [],
      kind: r.kind,
      status: r.status,
      time: (r.kind === "busca" ? r.start_time : r.end_time).slice(0, 5),
      tutor: r.tutor_first_name,
      phone: r.tutor_phone,
      phoneCountry: r.tutor_phone_country,
      address: r.address,
      addressRef: r.address_ref,
      pets: [],
    };
    s.routeIds.push(r.route_id);
    if (r.pet_name && !s.pets.includes(r.pet_name)) s.pets.push(r.pet_name);
    stops.set(key, s);
  }
  return { stops: Array.from(stops.values()), driverName: rows[0]?.driver_name ?? null, businessName: rows[0]?.business_name ?? null };
}
