import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Cake, MessageCircle, StickyNote } from "lucide-react";
import { todayInZone } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";
import { getAdminContext } from "@/lib/admin";
import { brl, maskPhone, whatsappLink } from "@/lib/format";
import { StatusBadge } from "@/components/admin/status-badge";
import { AutoConfirmBadge } from "@/components/admin/auto-confirm-badge";
import { AUTO_CONFIRM_REASON, type AutoConfirmReason } from "@/lib/confirm-mode";
import { CustomerDialog, DeleteCustomerButton } from "@/components/admin/clientes/customer-dialog";
import { ProfileCard, type ProfileField } from "@/components/admin/clientes/profile-card";
import { PackagesCard, type CustomerPackage } from "@/components/admin/clientes/packages-card";
import { AutoReminderToggle } from "@/components/admin/clientes/auto-reminder-toggle";
import { EditBookingButton } from "@/components/admin/agenda/edit-booking-dialog";
import { Button } from "@/components/ui/button";
import { getPlanContext } from "@/lib/plan";
import { loadSaleOptions } from "@/lib/package-sale";
import type { BookingStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

type Props = { params: { id: string } };

const br = (iso: string) => iso.split("-").reverse().join("/");

/** Dia e mês iguais aos de hoje (29/02 conta em 28/02 nos anos sem 29/02). Nunca calcula idade. */
function isBirthdayToday(birth: string, today: string) {
  const md = birth.slice(5);
  if (md === today.slice(5)) return true;
  const year = Number(today.slice(0, 4));
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  return md === "02-29" && !leap && today.slice(5) === "02-28";
}
const when = (ts: string) =>
  new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(ts));

const ACTION_LABEL: Record<string, string> = {
  created: "Agendado",
  confirmed: "Confirmado",
  cancelled: "Cancelado",
  completed: "Concluído",
  pending: "Voltou para pendente",
  rescheduled: "Remarcado",
  reminder: "Lembrete enviado",
  return_contact: "Chamado para voltar",
  item_added: "Serviço adicionado",
  item_removed: "Serviço removido",
  discount_set: "Desconto aplicado",
  discount_removed: "Desconto removido",
};

/** Mensagens automáticas do WhatsApp (42): enviada ou fora da validade, por tipo */
const AUTO_SENT: Record<string, string> = {
  confirmation: "Confirmação enviada",
  before: "Lembrete antes do horário enviado",
  eve: "Lembrete de véspera enviado",
};
const AUTO_EXPIRED: Record<string, string> = {
  confirmation: "Confirmação não enviada (fora da validade)",
  before: "Lembrete antes do horário não enviado (fora da validade)",
  eve: "Lembrete de véspera não enviado (fora da validade)",
};
function eventLabel(action: string, d: Record<string, unknown> | null) {
  const kind = typeof d?.kind === "string" ? d.kind : "";
  if (action === "whatsapp_auto") return AUTO_SENT[kind] ?? "Mensagem automática enviada";
  if (action === "whatsapp_auto_expired") return AUTO_EXPIRED[kind] ?? "Mensagem automática não enviada";
  return ACTION_LABEL[action] ?? action;
}

/** Detalhe dos eventos de edição (31_editar_agendamento): serviço, valores e motivo */
function editDetail(action: string, d: Record<string, unknown> | null) {
  if (!d) return "";
  if (action === "item_added" || action === "item_removed") {
    const extra = action === "item_added" && d.extended === false ? " (sem aumentar o tempo)" : "";
    return `: ${d.combo ? "combo " : ""}${String(d.service ?? "")} · ${brl(Number(d.price ?? 0))}${extra}`;
  }
  if (action === "discount_set") {
    const pct = d.kind === "percentual" ? `${Number(d.input).toLocaleString("pt-BR")}% · ` : "";
    return `: ${pct}${brl(Number(d.amount ?? 0))}${typeof d.reason === "string" && d.reason ? ` · ${d.reason}` : ""}`;
  }
  if (action === "discount_removed") return `: ${brl(Number(d.amount ?? 0))}`;
  return "";
}
/** motivo da confirmação automática gravado no histórico */
const autoReason = (d: Record<string, unknown> | null) =>
  typeof d?.reason === "string" ? AUTO_CONFIRM_REASON[d.reason as AutoConfirmReason] ?? null : null;

const ROLE_LABEL: Record<string, string> = {
  online: "pela vitrine",
  owner: "pela matriz",
  reception: "pela recepção",
  staff: "pelo profissional",
  sistema: "pelo sistema",
  automatico: "automático pelo WhatsApp",
};

// ---------------------------------------------------------------------
// PARTE 1 — Dados (o banco só devolve se o papel puder ver este cliente)
// ---------------------------------------------------------------------
export default async function ClientePage({ params }: Props) {
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) notFound();
  const { business, role } = await getAdminContext();
  const supabase = createClient();

  const COLS = "id, name, phone, email, notes, created_at, profile, no_auto_reminders";
  const loadCustomer = (cols: string) =>
    supabase.from("customers").select(cols).eq("id", params.id).eq("business_id", business.id).maybeSingle();
  type CustomerRow = {
    id: string; name: string; phone: string; email: string | null; notes: string | null; birth_date: string | null;
    created_at: string; profile: unknown; no_auto_reminders: boolean;
  };
  let res = await loadCustomer(`${COLS}, birth_date`);
  // 42703 = coluna não existe: a migration 41 ainda não rodou; a ficha abre sem a data de nascimento
  if (res.error?.code === "42703") res = await loadCustomer(COLS);
  const c = res.data ? ({ birth_date: null, ...(res.data as object) } as CustomerRow) : null;
  if (!c) notFound();

  const { data: bookings } = await supabase
    .from("bookings")
    .select("id, booking_date, start_time, service_name, professional_name, price, status, customer_package_id, auto_confirm_reason, booking_items(price, paid_by_package, customer_package_item_id)")
    .eq("customer_id", c.id)
    .order("booking_date", { ascending: false })
    .order("start_time", { ascending: false })
    .limit(100);

  const list = bookings ?? [];

  // ficha técnica: campos ativos do nicho do espaço
  const [{ data: fields }, { data: niche }] = await Promise.all([
    supabase
      .from("niche_profile_fields")
      .select("key, label, type, options, help")
      .eq("niche_id", business.subcategory ?? "")
      .eq("active", true)
      .order("sort_order"),
    supabase.from("niches").select("name").eq("id", business.subcategory ?? "").maybeSingle(),
  ]);
  const { data: events } = list.length
    ? await supabase
        .from("booking_events")
        .select("booking_id, action, actor_role, details, created_at")
        .in("booking_id", list.map((b) => b.id))
        .order("created_at")
    : { data: [] };

  const byBooking = new Map<string, { action: string; actor_role: string | null; details: Record<string, unknown>; created_at: string }[]>();
  for (const e of events ?? []) {
    const arr = byBooking.get(e.booking_id) ?? [];
    arr.push(e as never);
    byBooking.set(e.booking_id, arr);
  }

  // pacotes do cliente (saldo calculado no banco) e modelos à venda
  const canSell = role === "owner" || role === "reception";
  // WhatsApp automático liberado pela Genix (a função só responde para a matriz)
  const { data: waStatus } =
    role === "owner" ? await supabase.rpc("whatsapp_panel_status", { p_business: business.id }) : { data: null };
  const waEnabled = !!(waStatus as { genix_enabled?: boolean } | null)?.genix_enabled;
  const [{ data: pkgs }, { data: pkgItems }, sale, plan, { data: pkgModes }] = await Promise.all([
    supabase
      .from("customer_package_balance")
      .select("id, name, service_name, sessions_total, used, remaining, price, sold_at, expires_at, effective_status")
      .eq("customer_id", c.id)
      .order("sold_at", { ascending: false }),
    // 37_plano_fechado: saldo por serviço do pacote
    supabase
      .from("customer_package_item_balance")
      .select("id, customer_package_id, service_name, sessions_total, used, remaining, value_total, position")
      .eq("customer_id", c.id)
      .order("position"),
    // modelos à venda e profissionais (regras de datas fixas)
    canSell ? loadSaleOptions(supabase, business.id) : Promise.resolve({ templates: [], professionals: [] }),
    getPlanContext(business.id),
    // 39_pacote_datas_fixas: modo de agendamento de cada pacote
    supabase.from("customer_packages").select("id, schedule_mode").eq("customer_id", c.id),
  ]);
  const modeById = new Map(((pkgModes ?? []) as { id: string; schedule_mode: string }[]).map((m) => [m.id, m.schedule_mode]));

  type PkgItem = {
    id: string;
    customer_package_id: string;
    service_name: string;
    sessions_total: number;
    used: number;
    remaining: number;
    value_total: number;
    position: number;
  };
  type Booking = (typeof list)[number];
  type BookingItem = { price: number; paid_by_package: boolean; customer_package_item_id: string | null };
  const items = ((pkgItems ?? []) as PkgItem[]).map((i) => ({ ...i, value_total: Number(i.value_total) }));
  const itemById = new Map(items.map((i) => [i.id, i]));
  const bookingItems = (b: Booking) => (b.booking_items ?? []) as BookingItem[];
  // serviços de pacote usados na visita (item 0 e adicionais do Editar)
  const linked = (b: Booking) =>
    bookingItems(b).flatMap((i) => (i.customer_package_item_id ? [itemById.get(i.customer_package_item_id)].filter((x) => !!x) : [])) as PkgItem[];

  // agora em São Paulo, "yyyy-mm-dd hh:mm" (para contar as sessões futuras)
  const nowSP = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "America/Sao_Paulo",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).format(new Date());
  const isFuture = (b: Booking) => `${b.booking_date} ${b.start_time.slice(0, 5)}` > nowSP;

  const packages: CustomerPackage[] = (pkgs ?? []).map((p) => ({
    ...p,
    price: Number(p.price),
    fixed: modeById.get(p.id) === "fixed",
    items: items
      .filter((i) => i.customer_package_id === p.id)
      .map(({ id, service_name, sessions_total, used, remaining }) => ({ id, service_name, sessions_total, used, remaining })),
    sessions: list
      .filter((b) => linked(b).some((i) => i.customer_package_id === p.id))
      .sort((a, b) => (a.booking_date + a.start_time).localeCompare(b.booking_date + b.start_time))
      .map((b) => ({
        id: b.id,
        booking_date: b.booking_date,
        start_time: b.start_time,
        professional_name: b.professional_name,
        status: b.status,
        services: linked(b).filter((i) => i.customer_package_id === p.id).map((i) => i.service_name),
      })),
    // cancelar junto: as mesmas que cancel_customer_package cancela (serviço principal do pacote)
    future_count: list.filter(
      (b) => b.customer_package_id === p.id && (b.status === "pending" || b.status === "confirmed") && isFuture(b)
    ).length,
  })) as CustomerPackage[];
  const pkgById = new Map(packages.map((p) => [p.id, p]));

  // valor cobrado no atendimento: total final menos o que o pacote já pagou
  const charged = (b: Booking) => {
    const its = bookingItems(b);
    const byPackage = its.length
      ? its.filter((i) => i.paid_by_package).reduce((s, i) => s + Number(i.price), 0)
      : b.customer_package_id ? Number(b.price) : 0;
    return Math.max(Number(b.price) - byPackage, 0);
  };

  // total gasto: cada serviço do pacote conta pelo valor de 1 sessão + o cobrado (igual a customer_summary)
  const done = list.filter((b) => b.status === "completed");
  const total = done.reduce(
    (s, b) => s + linked(b).reduce((u, i) => u + i.value_total / i.sessions_total, 0) + charged(b),
    0
  );
  // nome do(s) pacote(s) usados na visita, para o histórico
  const packageNames = (b: Booking) =>
    Array.from(new Set(linked(b).map((i) => pkgById.get(i.customer_package_id)?.name).filter(Boolean))).join(", ");
  const wa = whatsappLink(c.phone, `Olá, ${c.name.split(" ")[0]}! Aqui é do ${business.name}.`);

  // -------------------------------------------------------------------
  // PARTE 2 — Página
  // -------------------------------------------------------------------
  return (
    <main className="mx-auto max-w-4xl space-y-8 p-4 md:p-8">
      <Link href="/admin/clientes" className="inline-flex min-h-11 items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Clientes
      </Link>

      {/* Cabeçalho */}
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <span className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-secondary font-heading text-2xl text-primary">
            {c.name.charAt(0).toUpperCase()}
          </span>
          <div className="min-w-0">
            <h1 className="break-words text-3xl">{c.name}</h1>
            <p className="break-words text-muted-foreground [overflow-wrap:anywhere]">
              {maskPhone(c.phone)}
              {c.email && ` · ${c.email}`}
            </p>
            {c.birth_date && (
              <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground" data-testid="ficha-nascimento">
                <span className="inline-flex items-center gap-1">
                  <Cake className="h-4 w-4 text-primary" /> Nascimento: {br(c.birth_date)}
                </span>
                {isBirthdayToday(c.birth_date, todayInZone(business.timezone)) && (
                  <span className="rounded-full bg-[#F2C078]/40 px-2.5 py-0.5 text-xs font-semibold text-[#7A4520]" data-testid="selo-aniversario-hoje">
                    Aniversário hoje
                  </span>
                )}
              </p>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {wa && (
            <Button asChild className="h-11 bg-whatsapp text-white hover:bg-whatsapp-hover">
              <a href={wa} target="_blank" rel="noopener noreferrer" data-testid="btn-whatsapp-ficha">
                <MessageCircle className="mr-1.5 h-4 w-4" /> WhatsApp
              </a>
            </Button>
          )}
          <CustomerDialog customer={c} />
          {role === "owner" && <DeleteCustomerButton id={c.id} name={c.name} />}
        </div>
      </header>

      {/* Resumo */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="min-w-0 rounded-2xl border bg-card p-4">
          <p className="text-sm text-muted-foreground">Visitas</p>
          <p className="mt-1 break-words font-heading text-2xl sm:text-3xl">{done.length}</p>
        </div>
        <div className="min-w-0 rounded-2xl border bg-card p-4">
          <p className="text-sm text-muted-foreground">Total gasto</p>
          <p className="mt-1 break-words font-heading text-2xl sm:text-3xl">{brl(total)}</p>
        </div>
        <div className="col-span-2 min-w-0 rounded-2xl border bg-card p-4 sm:col-span-1">
          <p className="text-sm text-muted-foreground">Cliente desde</p>
          <p className="mt-1 break-words font-heading text-2xl sm:text-3xl">{br(c.created_at.slice(0, 10)).slice(3)}</p>
        </div>
      </section>

      {c.notes && (
        <p className="flex gap-2 whitespace-pre-line rounded-2xl bg-secondary p-4 text-sm">
          <StickyNote className="mt-0.5 h-4 w-4 shrink-0 text-primary" /> {c.notes}
        </p>
      )}

      {/* Lembretes automáticos (beta): só para espaço liberado pela Genix, num plano pago */}
      {canSell && plan.tier === "completo" && waEnabled && (
        <AutoReminderToggle customerId={c.id} initial={c.no_auto_reminders} />
      )}

      {/* Pacotes: no Grátis só aparece se já houver pacote vendido */}
      {(plan.tier === "completo" || packages.length > 0) && (
        <PackagesCard
          customerId={c.id}
          packages={packages}
          templates={sale.templates}
          canSell={canSell}
          professionals={sale.professionals}
          locked={plan.tier !== "completo"}
        />
      )}

      {/* Ficha técnica */}
      {(fields ?? []).length > 0 ? (
        <ProfileCard
          customerId={c.id}
          nicheName={niche?.name ?? ""}
          fields={(fields ?? []) as ProfileField[]}
          profile={(c.profile as Record<string, string>) ?? {}}
        />
      ) : (
        role === "owner" && (
          <p className="rounded-2xl border border-dashed bg-white p-4 text-sm text-muted-foreground">
            Escolha o <strong>tipo de espaço</strong> em{" "}
            <Link href="/admin/configuracoes" className="underline">Configurações</Link> para liberar a ficha técnica dos clientes.
          </p>
        )
      )}

      {/* Histórico */}
      <section className="space-y-3">
        <h2 className="text-2xl">Histórico</h2>
        {list.length === 0 ? (
          <p className="rounded-2xl border border-dashed bg-white p-6 text-center text-muted-foreground">Nenhum agendamento ainda.</p>
        ) : (
          <ul className="space-y-3">
            {list.map((b) => (
              <li key={b.id} className="rounded-2xl border bg-card p-4" data-testid={`historico-${b.id}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-semibold">{b.service_name}</p>
                    <p className="text-sm text-muted-foreground">
                      {br(b.booking_date)} às {b.start_time.slice(0, 5)} · {b.professional_name} ·{" "}
                      {linked(b).length > 0 ? `pacote ${packageNames(b)}`.trim() : brl(b.price)}
                      {linked(b).length > 0 && charged(b) > 0 && ` + ${brl(charged(b))}`}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <AutoConfirmBadge status={b.status} reason={b.auto_confirm_reason} testId={`selo-auto-confirmado-${b.id}`} />
                    <StatusBadge status={b.status as BookingStatus} />
                    {(b.status === "pending" || b.status === "confirmed") && (
                      <EditBookingButton bookingId={b.id} customerName={c.name} />
                    )}
                  </div>
                </div>
                {(byBooking.get(b.id) ?? []).length > 0 && (
                  <ol className="mt-3 space-y-1 border-l-2 border-secondary pl-3 text-xs text-muted-foreground">
                    {byBooking.get(b.id)!.map((e, i) => {
                      const to = (e.details?.to ?? null) as { date?: string; time?: string } | null;
                      return (
                        <li key={i}>
                          <span className="font-semibold text-foreground">{eventLabel(e.action, e.details)}</span>{" "}
                          {ROLE_LABEL[e.actor_role ?? ""] ?? ""} · {when(e.created_at)}
                          {e.action === "rescheduled" && to?.date && ` → ${br(to.date)} às ${to.time}`}
                          {e.action === "confirmed" && autoReason(e.details) && ` · ${autoReason(e.details)}`}
                          {editDetail(e.action, e.details)}
                        </li>
                      );
                    })}
                  </ol>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
