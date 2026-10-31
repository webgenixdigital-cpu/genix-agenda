import Link from "next/link";
import { addMonths, endOfMonth, format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ChevronLeft, ChevronRight, Info } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireRoles } from "@/lib/admin";
import { todayISO } from "@/lib/dates";
import { brl, duration } from "@/lib/format";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

type Props = { searchParams: { mes?: string } };

// ---------------------------------------------------------------------
// PARTE 1 — Dados (o banco já limita aos atendimentos deste profissional)
// ---------------------------------------------------------------------
export default async function GanhosPage({ searchParams }: Props) {
  const { business, professionalId } = await requireRoles(["staff"]);
  const supabase = createClient();

  const today = todayISO();
  const month = /^\d{4}-\d{2}$/.test(searchParams.mes ?? "") ? searchParams.mes! : today.slice(0, 7);
  const monthDate = parseISO(`${month}-01`);
  const start = `${month}-01`;
  const end = format(endOfMonth(monthDate), "yyyy-MM-dd");
  const prev = format(addMonths(monthDate, -1), "yyyy-MM");
  const next = format(addMonths(monthDate, 1), "yyyy-MM");
  const isCurrent = month === today.slice(0, 7);

  const [{ data: me }, { data: done }, { data: links }, { data: services }] = await Promise.all([
    supabase.from("professionals").select("name, commission_pct").eq("id", professionalId ?? "").maybeSingle(),
    supabase
      .from("bookings")
      .select("id, booking_date, start_time, service_name, customer_name, price")
      .eq("business_id", business.id)
      .eq("status", "completed")
      .gte("booking_date", start)
      .lte("booking_date", end)
      .order("booking_date", { ascending: false })
      .order("start_time", { ascending: false }),
    supabase.from("professional_services").select("service_id").eq("professional_id", professionalId ?? ""),
    supabase.from("services").select("id, name, price, duration_min").eq("business_id", business.id).eq("active", true).order("sort_order"),
  ]);

  const list = done ?? [];
  const gross = list.reduce((s, b) => s + Number(b.price), 0);
  const pct = Number(me?.commission_pct ?? 0);
  const commission = (gross * pct) / 100;

  const linked = new Set((links ?? []).map((l) => l.service_id));
  const myServices = (services ?? []).filter((s) => linked.size === 0 || linked.has(s.id));

  // -------------------------------------------------------------------
  // PARTE 2 — Página
  // -------------------------------------------------------------------
  return (
    <main className="mx-auto max-w-4xl space-y-8 p-4 md:p-8">
      <header className="text-center">
        <h1 className="text-3xl md:text-4xl">Meus ganhos</h1>
        <div className="mt-3 flex items-center justify-center gap-1">
          <Button asChild variant="outline" size="icon" className="h-10 w-10">
            <Link href={`/admin/ganhos?mes=${prev}`} aria-label="Mês anterior"><ChevronLeft className="h-5 w-5" /></Link>
          </Button>
          <p className="min-w-[150px] text-center font-semibold capitalize">{format(monthDate, "MMMM 'de' yyyy", { locale: ptBR })}</p>
          <Button asChild variant="outline" size="icon" className="h-10 w-10">
            <Link href={`/admin/ganhos?mes=${next}`} aria-label="Próximo mês"><ChevronRight className="h-5 w-5" /></Link>
          </Button>
          {!isCurrent && (
            <Button asChild variant="ghost" className="h-10"><Link href="/admin/ganhos">Mês atual</Link></Button>
          )}
        </div>
      </header>

      <section className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border bg-card p-4 md:p-5">
          <p className="text-sm text-muted-foreground">Atendimentos concluídos</p>
          <p className="mt-2 font-heading text-3xl">{list.length}</p>
        </div>
        <div className="rounded-2xl border bg-card p-4 md:p-5">
          <p className="text-sm text-muted-foreground">Valor dos serviços</p>
          <p className="mt-2 font-heading text-3xl">{brl(gross)}</p>
        </div>
        <div className="col-span-2 rounded-2xl bg-foreground p-4 text-background md:p-5 lg:col-span-1" data-testid="comissao-estimada">
          <p className="text-sm text-stone-300">Comissão estimada {pct ? `(${String(pct).replace(".", ",")}%)` : ""}</p>
          <p className="mt-2 font-heading text-3xl">{brl(commission)}</p>
        </div>
      </section>

      <p className="flex gap-2 rounded-xl bg-secondary p-4 text-sm text-muted-foreground">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        Valor estimado a partir dos atendimentos concluídos e do seu percentual de comissão. O fechamento oficial é feito
        com o responsável pelo espaço.
      </p>

      <section className="rounded-2xl border bg-card">
        <h2 className="border-b p-5 font-sans text-base font-semibold">Atendimentos do mês</h2>
        {list.length === 0 ? (
          <p className="p-8 text-center text-muted-foreground">Nenhum atendimento concluído neste mês.</p>
        ) : (
          <ul className="divide-y">
            {list.map((b) => (
              <li key={b.id} className="flex items-center gap-3 px-4 py-3 md:px-5">
                <span className="w-14 shrink-0 text-sm text-muted-foreground">
                  {b.booking_date.split("-").reverse().slice(0, 2).join("/")}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{b.service_name}</p>
                  <p className="truncate text-xs text-muted-foreground">{b.customer_name}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold">{brl(b.price)}</p>
                  {pct > 0 && <p className="text-xs text-green-700">+ {brl((Number(b.price) * pct) / 100)}</p>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-2xl border bg-card p-5">
        <h2 className="font-sans text-base font-semibold">Serviços que você realiza</h2>
        <ul className="mt-3 divide-y">
          {myServices.map((s) => (
            <li key={s.id} className="flex justify-between py-2 text-sm">
              <span>{s.name}</span>
              <span className="text-muted-foreground">{duration(s.duration_min)} · {brl(s.price)}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-muted-foreground">Preços e duração são definidos pelo responsável pelo espaço.</p>
      </section>
    </main>
  );
}
