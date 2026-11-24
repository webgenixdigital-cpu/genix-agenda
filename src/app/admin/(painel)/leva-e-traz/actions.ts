"use server";

// 4b — Leva e traz (banho e tosa). O RLS da 63 é a fonte da verdade:
// rotas = matriz e recepção; motoristas = só a matriz.
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getEditorContext } from "@/lib/admin";
import { PET_NICHE_ID, ROUTE_STATUSES, type RouteStatus } from "@/lib/pets";
import { activeDrivers, pickDriver, type ActiveDriver } from "@/lib/drivers";

type Result = { ok: true } | { ok: false; error: string };

const PATH = "/admin/leva-e-traz";

async function ctx(roles: string[]) {
  const c = await getEditorContext();
  if (c.business.subcategory !== PET_NICHE_ID) return { error: "Disponível só para banho e tosa." } as const;
  if (!roles.includes(c.role)) return { error: "Sem permissão para esta ação." } as const;
  return { business: c.business, supabase: createClient() } as const;
}

// ---------------------------------------------------------------------
// PARTE 1 — Paradas: motorista, ordem e status
// ---------------------------------------------------------------------
export async function assignDriver(routeIds: string[], driverId: string | null): Promise<Result> {
  const c = await ctx(["owner", "reception"]);
  if ("error" in c) return { ok: false, error: c.error! };
  if (routeIds.length === 0) return { ok: false, error: "Nenhuma parada escolhida." };
  if (driverId) {
    const { data: d } = await c.supabase
      .from("business_drivers").select("id").eq("id", driverId).eq("business_id", c.business.id).eq("active", true).maybeSingle();
    if (!d) return { ok: false, error: "Motorista não encontrado ou inativo." };
  }
  const { error } = await c.supabase
    .from("transport_routes").update({ driver_id: driverId }).in("id", routeIds).eq("business_id", c.business.id);
  if (error) return { ok: false, error: "Não foi possível escolher o motorista." };
  revalidatePath(PATH);
  return { ok: true };
}

export async function setRouteStatus(routeIds: string[], status: RouteStatus): Promise<Result> {
  const c = await ctx(["owner", "reception"]);
  if ("error" in c) return { ok: false, error: c.error! };
  if (!ROUTE_STATUSES.includes(status)) return { ok: false, error: "Status inválido." };
  const { error } = await c.supabase
    .from("transport_routes").update({ status }).in("id", routeIds).eq("business_id", c.business.id);
  if (error) return { ok: false, error: "Não foi possível mudar o status." };
  revalidatePath(PATH);
  return { ok: true };
}

/** Grava a ordem da rota (lista completa do dia, na ordem nova) */
export async function saveRouteOrder(routeIdsInOrder: string[][]): Promise<Result> {
  const c = await ctx(["owner", "reception"]);
  if ("error" in c) return { ok: false, error: c.error! };
  for (let i = 0; i < routeIdsInOrder.length; i++) {
    const { error } = await c.supabase
      .from("transport_routes").update({ stop_order: i + 1 }).in("id", routeIdsInOrder[i]).eq("business_id", c.business.id);
    if (error) return { ok: false, error: "Não foi possível salvar a ordem." };
  }
  revalidatePath(PATH);
  return { ok: true };
}

// ---------------------------------------------------------------------
// PARTE 2 — Motoristas (só a matriz)
// ---------------------------------------------------------------------
export async function saveDriver(id: string | null, input: { name: string; phone: string; active: boolean }): Promise<Result> {
  const c = await ctx(["owner"]);
  if ("error" in c) return { ok: false, error: c.error! };
  const name = input.name.trim();
  const phone = input.phone.replace(/\D/g, "");
  if (name.length < 2 || name.length > 60) return { ok: false, error: "Informe o nome do motorista." };
  if (phone && (phone.length < 10 || phone.length > 13)) return { ok: false, error: "WhatsApp do motorista inválido (com DDD)." };
  const row = { name, phone: phone || null, active: input.active };
  const { error } = id
    ? await c.supabase.from("business_drivers").update(row).eq("id", id).eq("business_id", c.business.id)
    : await c.supabase.from("business_drivers").insert({ ...row, business_id: c.business.id });
  if (error) return { ok: false, error: "Não foi possível salvar o motorista." };
  revalidatePath(PATH);
  return { ok: true };
}

// ---------------------------------------------------------------------
// PARTE 3 — Leva e traz de um agendamento que já existe (card da agenda)
// ---------------------------------------------------------------------
type Transport = "nenhum" | "busca" | "entrega" | "busca_entrega";
const TRANSPORTS: Transport[] = ["nenhum", "busca", "entrega", "busca_entrega"];
const kindsOf = (t: Transport) => (t === "busca_entrega" ? ["busca", "entrega"] : t === "nenhum" ? [] : [t]);
/** paradas que já começaram não podem sair */
const STARTED: RouteStatus[] = ["a_caminho", "coletado", "na_loja", "saiu_entrega", "entregue"];

export type BookingTransportInfo = {
  transport: Transport;
  fee: number;
  address: string | null;
  addressRef: string | null;
  /** motorista atual das paradas (null = sem) */
  driverId: string | null;
  /** ativos; a escolha só aparece com 2 ou mais */
  drivers: ActiveDriver[];
};

export async function getBookingTransport(bookingId: string): Promise<{ ok: true; info: BookingTransportInfo } | { ok: false; error: string }> {
  const c = await ctx(["owner", "reception"]);
  if ("error" in c) return { ok: false, error: c.error! };
  const { data: b } = await c.supabase
    .from("bookings").select("transport, transport_fee, customer:customers(address, address_ref)")
    .eq("id", bookingId).eq("business_id", c.business.id).maybeSingle();
  if (!b) return { ok: false, error: "Agendamento não encontrado." };
  const cust = b.customer as unknown as { address: string | null; address_ref: string | null } | null;
  const [{ data: r }, drivers] = await Promise.all([
    c.supabase.from("transport_routes").select("driver_id").eq("booking_id", bookingId).eq("business_id", c.business.id).limit(1),
    activeDrivers(c.supabase, c.business.id),
  ]);
  return {
    ok: true,
    info: {
      transport: b.transport as Transport,
      fee: Number(b.transport_fee ?? 0),
      address: cust?.address ?? null,
      addressRef: cust?.address_ref ?? null,
      driverId: (r?.[0]?.driver_id as string | null) ?? null,
      drivers,
    },
  };
}

export async function setBookingTransport(
  bookingId: string,
  input: { transport: Transport; fee: string; address: string; addressRef: string; driverId?: string | null }
): Promise<Result> {
  const c = await ctx(["owner", "reception"]);
  if ("error" in c) return { ok: false, error: c.error! };
  if (!TRANSPORTS.includes(input.transport)) return { ok: false, error: "Escolha o leva e traz." };
  const fee = Number((input.fee || "0").replace(/\./g, "").replace(",", "."));
  if (!Number.isFinite(fee) || fee < 0 || fee > 9999) return { ok: false, error: "Taxa do leva e traz inválida." };
  if (input.transport !== "nenhum") {
    if (input.address.trim().length < 5) return { ok: false, error: "Informe o endereço do tutor para o leva e traz." };
    if (input.address.length > 200 || input.addressRef.length > 120) return { ok: false, error: "Endereço muito longo." };
  }

  const { data: b } = await c.supabase
    .from("bookings").select("id, status, customer_id, booking_date, start_time").eq("id", bookingId).eq("business_id", c.business.id).maybeSingle();
  if (!b) return { ok: false, error: "Agendamento não encontrado." };
  if (b.status !== "pending" && b.status !== "confirmed") return { ok: false, error: "Só dá para mudar o leva e traz de agendamentos pendentes ou confirmados." };

  // paradas atuais × as que precisam existir
  const { data: routes } = await c.supabase
    .from("transport_routes").select("id, kind, status").eq("booking_id", b.id).eq("business_id", c.business.id);
  const want = kindsOf(input.transport);
  const toRemove = (routes ?? []).filter((r) => !want.includes(r.kind as string));
  if (toRemove.some((r) => STARTED.includes(r.status as RouteStatus))) {
    return { ok: false, error: "Essa busca ou entrega já começou. Mude o status na tela Leva e traz antes de tirar." };
  }
  const toAdd = want.filter((k) => !(routes ?? []).some((r) => r.kind === k));

  if (input.transport !== "nenhum" && b.customer_id) {
    await c.supabase.from("customers").update({
      address: input.address.trim(),
      address_ref: input.addressRef.trim() || null,
    }).eq("id", b.customer_id).eq("business_id", c.business.id);
  }

  const { error: upErr } = await c.supabase
    .from("bookings")
    .update({ transport: input.transport, transport_fee: input.transport === "nenhum" ? 0 : Math.round(fee * 100) / 100 })
    .eq("id", b.id).eq("business_id", c.business.id);
  if (upErr) return { ok: false, error: "Não foi possível salvar o leva e traz." };

  if (toRemove.length) {
    const { error } = await c.supabase.from("transport_routes").delete().in("id", toRemove.map((r) => r.id)).eq("business_id", c.business.id);
    if (error) return { ok: false, error: "Leva e traz salvo, mas não foi possível tirar uma parada. Confira na tela Leva e traz." };
  }
  // motorista: o escolhido; sem escolha, mantém o das paradas que ficam ou escolhe (único ativo / livre no horário)
  const kept = (routes ?? []).filter((r) => want.includes(r.kind as string)) as { id: string; driver_id?: string | null }[];
  const { data: keptDrivers } = kept.length
    ? await c.supabase.from("transport_routes").select("driver_id").in("id", kept.map((r) => r.id))
    : { data: [] };
  const current = (keptDrivers ?? []).find((r) => r.driver_id)?.driver_id as string | undefined;
  const driverId = want.length
    ? await pickDriver(c.supabase, c.business.id, b as { id: string; booking_date: string; start_time: string }, input.driverId ?? current ?? null)
    : null;
  if (kept.length && driverId && driverId !== current) {
    await c.supabase.from("transport_routes").update({ driver_id: driverId }).in("id", kept.map((r) => r.id)).eq("business_id", c.business.id);
  }
  if (toAdd.length) {
    const { error } = await c.supabase
      .from("transport_routes").insert(toAdd.map((kind) => ({ business_id: c.business.id, booking_id: b.id, kind, driver_id: driverId })));
    if (error) return { ok: false, error: "Leva e traz salvo, mas não foi possível criar a parada. Confira na tela Leva e traz." };
  }

  revalidatePath(PATH);
  revalidatePath("/admin/agenda");
  if (b.customer_id) revalidatePath(`/admin/clientes/${b.customer_id}`);
  return { ok: true };
}

// ---------------------------------------------------------------------
// PARTE 4 — Link do app do motorista (66_link_motorista; só a matriz)
// O código só sai aqui, na hora de gerar; o banco não o devolve depois.
// ---------------------------------------------------------------------
export async function generateDriverLink(driverId: string): Promise<{ ok: true; token: string } | { ok: false; error: string }> {
  const c = await ctx(["owner"]);
  if ("error" in c) return { ok: false, error: c.error! };
  const { data, error } = await c.supabase.rpc("driver_link_reset", { p_driver: driverId });
  if (error || typeof data !== "string") return { ok: false, error: "Não foi possível gerar o link." };
  revalidatePath(PATH);
  return { ok: true, token: data };
}

export async function revokeDriverLink(driverId: string): Promise<Result> {
  const c = await ctx(["owner"]);
  if ("error" in c) return { ok: false, error: c.error! };
  const { error } = await c.supabase.rpc("driver_link_revoke", { p_driver: driverId });
  if (error) return { ok: false, error: "Não foi possível desligar o link." };
  revalidatePath(PATH);
  return { ok: true };
}
