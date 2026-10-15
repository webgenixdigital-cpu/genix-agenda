import { CalendarOff, Repeat } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getAdminContext } from "@/lib/admin";
import { getPlanContext } from "@/lib/plan";
import { LockedFeature } from "@/components/admin/locked-feature";
import { todayISO } from "@/lib/dates";
import { NewBlockDialog } from "@/components/admin/bloqueios/new-block-dialog";
import { DeleteBlockButton } from "@/components/admin/bloqueios/delete-block-button";

export const dynamic = "force-dynamic";

const DAYS_FULL = ["domingos", "segundas", "terças", "quartas", "quintas", "sextas", "sábados"];

const br = (iso: string) => iso.split("-").reverse().join("/");

function joinPt(list: string[]) {
  if (list.length <= 1) return list.join("");
  return `${list.slice(0, -1).join(", ")} e ${list[list.length - 1]}`;
}

export default async function BloqueiosPage() {
  const { business } = await getAdminContext();
  const plan = await getPlanContext(business.id);
  if (plan.tier === "gratis") return <LockedFeature feature="bloqueios" />;

  const supabase = createClient();
  const today = todayISO();

  const [{ data: blocks }, { data: professionals }] = await Promise.all([
    supabase
      .from("schedule_blocks")
      .select("id, professional_id, date_start, date_end, time_start, time_end, reason, recurring, weekdays")
      .eq("business_id", business.id)
      .gte("date_end", today)
      .order("date_start"),
    supabase.from("professionals").select("id, name").eq("business_id", business.id).eq("active", true).order("sort_order"),
  ]);

  const pros = professionals ?? [];
  const list = blocks ?? [];

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-4 md:p-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl md:text-4xl">Bloqueios</h1>
          <p className="mt-1 max-w-lg text-sm text-muted-foreground">
            Férias, folgas, cursos e manutenção. Nos períodos bloqueados a vitrine não oferece horários.
          </p>
        </div>
        <NewBlockDialog professionals={pros} businessName={business.name} />
      </header>

      {list.length === 0 ? (
        <div className="rounded-2xl border border-dashed bg-white p-10 text-center">
          <p className="font-heading text-2xl">Nenhum bloqueio ativo</p>
          <p className="mt-2 text-muted-foreground">Toda a agenda está aberta para agendamentos.</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {list.map((k) => {
            const who = k.professional_id
              ? pros.find((p) => p.id === k.professional_id)?.name ?? "Profissional removido"
              : "Toda a equipe";
            const hours = k.time_start
              ? `das ${k.time_start.slice(0, 5)} às ${k.time_end?.slice(0, 5)}`
              : "dia inteiro";
            const period = k.recurring
              ? `Todas as ${joinPt((k.weekdays as number[]).map((d) => DAYS_FULL[d]))}, até ${br(k.date_end)}`
              : k.date_start === k.date_end
                ? br(k.date_start)
                : `${br(k.date_start)} até ${br(k.date_end)}`;
            const active = k.date_start <= today;

            return (
              <li key={k.id} className="flex items-start gap-4 rounded-2xl border bg-card p-4 md:p-5" data-testid={`bloqueio-${k.id}`}>
                <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-red-50 text-red-700">
                  {k.recurring ? <Repeat className="h-5 w-5" /> : <CalendarOff className="h-5 w-5" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold">{k.reason ?? "Bloqueio"}</p>
                    {active && (
                      <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-800 ring-1 ring-inset ring-red-600/30">
                        Em vigor
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-sm">{who}</p>
                  <p className="text-sm text-muted-foreground first-letter:uppercase">
                    {period}, {hours}
                  </p>
                </div>
                <DeleteBlockButton id={k.id} />
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
