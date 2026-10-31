import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, MessageCircle, StickyNote } from "lucide-react";
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
import { Button } from "@/components/ui/button";
import { getPlanContext } from "@/lib/plan";
import type { BookingStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

type Props = { params: { id: string } };

const br = (iso: string) => iso.split("-").reverse().join("/");
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
};
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

  const { data: c } = await supabase
    .from("customers")
    .select("id, name, phone, email, notes, created_at, profile, no_auto_reminders")
    .eq("id", params.id)
    .eq("business_id", business.id)
    .maybeSingle();
  if (!c) notFound();

  const { data: bookings } = await supabase
    .from("bookings")
    .select("id, booking_date, start_time, service_name, professional_name, price, status, customer_package_id, auto_confirm_reason")
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
  const [{ data: pkgs }, { data: templates }, plan] = await Promise.all([
    supabase
      .from("customer_package_balance")
      .select("id, name, service_name, sessions_total, used, remaining, price, sold_at, expires_at, effective_status")
      .eq("customer_id", c.id)
      .order("sold_at", { ascending: false }),
    canSell
      ? supabase
          .from("package_templates")
          .select("id, name, sessions, price, validity_days")
          .eq("business_id", business.id)
          .eq("active", true)
          .order("sort_order")
      : Promise.resolve({ data: [] }),
    getPlanContext(business.id),
  ]);
  const packages: CustomerPackage[] = (pkgs ?? []).map((p) => ({
    ...p,
    price: Number(p.price),
    sessions: list
      .filter((b) => b.customer_package_id === p.id)
      .sort((a, b) => (a.booking_date + a.start_time).localeCompare(b.booking_date + b.start_time)),
  })) as CustomerPackage[];
  const pkgById = new Map(packages.map((p) => [p.id, p]));

  // total gasto: sessão de pacote conta pelo valor proporcional (igual a customer_summary)
  const done = list.filter((b) => b.status === "completed");
  const total = done.reduce((s, b) => {
    const p = b.customer_package_id ? pkgById.get(b.customer_package_id) : undefined;
    return s + (p ? p.price / p.sessions_total : Number(b.price));
  }, 0);
  const wa = whatsappLink(c.phone, `Olá, ${c.name.split(" ")[0]}! Aqui é do ${business.name}.`);

  // -------------------------------------------------------------------
  // PARTE 2 — Página
  // -------------------------------------------------------------------
  return (
    <main className="mx-auto max-w-4xl space-y-6 p-4 md:p-8">
      <Link href="/admin/clientes" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Clientes
      </Link>

      {/* Cabeçalho */}
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <span className="grid h-14 w-14 place-items-center rounded-full bg-secondary font-heading text-2xl text-primary">
            {c.name.charAt(0).toUpperCase()}
          </span>
          <div>
            <h1 className="text-3xl">{c.name}</h1>
            <p className="text-muted-foreground">
              {maskPhone(c.phone)}
              {c.email && ` · ${c.email}`}
            </p>
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
      <section className="grid grid-cols-3 gap-3">
        <div className="rounded-2xl border bg-card p-4">
          <p className="text-sm text-muted-foreground">Visitas</p>
          <p className="mt-1 font-heading text-3xl">{done.length}</p>
        </div>
        <div className="rounded-2xl border bg-card p-4">
          <p className="text-sm text-muted-foreground">Total gasto</p>
          <p className="mt-1 font-heading text-3xl">{brl(total)}</p>
        </div>
        <div className="rounded-2xl border bg-card p-4">
          <p className="text-sm text-muted-foreground">Cliente desde</p>
          <p className="mt-1 font-heading text-3xl">{br(c.created_at.slice(0, 10)).slice(3)}</p>
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
          templates={(templates ?? []).map((t) => ({ ...t, price: Number(t.price) }))}
          canSell={canSell}
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
                      {b.customer_package_id ? `pacote ${pkgById.get(b.customer_package_id)?.name ?? ""}`.trim() : brl(b.price)}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <AutoConfirmBadge status={b.status} reason={b.auto_confirm_reason} testId={`selo-auto-confirmado-${b.id}`} />
                    <StatusBadge status={b.status as BookingStatus} />
                  </div>
                </div>
                {(byBooking.get(b.id) ?? []).length > 0 && (
                  <ol className="mt-3 space-y-1 border-l-2 border-secondary pl-3 text-xs text-muted-foreground">
                    {byBooking.get(b.id)!.map((e, i) => {
                      const to = (e.details?.to ?? null) as { date?: string; time?: string } | null;
                      return (
                        <li key={i}>
                          <span className="font-semibold text-foreground">{ACTION_LABEL[e.action] ?? e.action}</span>{" "}
                          {ROLE_LABEL[e.actor_role ?? ""] ?? ""} · {when(e.created_at)}
                          {e.action === "rescheduled" && to?.date && ` → ${br(to.date)} às ${to.time}`}
                          {e.action === "confirmed" && autoReason(e.details) && ` · ${autoReason(e.details)}`}
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
