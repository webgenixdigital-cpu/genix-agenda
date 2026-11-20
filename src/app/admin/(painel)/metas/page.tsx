import { Ajuda } from "@/components/ajuda";
import { LockedFeature } from "@/components/admin/locked-feature";
import { GoalsList } from "@/components/admin/metas/goals-list";
import { requireRoles } from "@/lib/admin";
import { todayInZone } from "@/lib/dates";
import type { GoalWithProgress } from "@/lib/goals";
import { allows, getPlanContext } from "@/lib/plan";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function MetasPage() {
  // a demonstração (viewer) vê os botões; ao salvar, o servidor bloqueia (?demo=bloqueado)
  const { business } = await requireRoles(["owner", "reception", "viewer"]);
  const plan = await getPlanContext(business.id);
  if (!allows(plan, "profissional")) return <LockedFeature feature="metas" />;

  const team = allows(plan, "equipe");
  const supabase = createClient();
  const [{ data: goals, error }, { data: professionals }] = await Promise.all([
    supabase.rpc("goals_with_progress", { p_business: business.id }),
    team
      ? supabase.from("professionals").select("id, name").eq("business_id", business.id).eq("active", true).order("sort_order")
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ]);

  const list = ((goals ?? []) as GoalWithProgress[]).map((g) => ({
    ...g,
    target: Number(g.target),
    realized: Number(g.realized),
  }));

  return (
    <main className="mx-auto max-w-4xl space-y-8 p-4 md:p-8">
      <header className="flex flex-col items-center gap-1 text-center">
        <h1 className="text-3xl md:text-4xl">Metas <Ajuda id="metas" className="-ml-2" /></h1>
        <p className="mx-auto max-w-lg text-sm text-muted-foreground">
          Defina onde quer chegar no período e veja quanto falta, todos os dias.
        </p>
      </header>

      {error ? (
        <p className="rounded-lg bg-red-50 p-3 text-center text-sm text-destructive">
          Não foi possível carregar as metas agora. Tente de novo em instantes.
        </p>
      ) : (
        <GoalsList
          goals={list}
          today={todayInZone(business.timezone)}
          professionals={professionals ?? []}
          team={team}
        />
      )}
    </main>
  );
}
