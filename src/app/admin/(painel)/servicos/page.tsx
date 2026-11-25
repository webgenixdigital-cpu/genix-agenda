import { Ajuda } from "@/components/ajuda";
import { createClient } from "@/lib/supabase/server";
import { requireRoles } from "@/lib/admin";
import { allows, getPlanContext } from "@/lib/plan";
import { ServicesManager } from "@/components/admin/servicos/services-manager";
import { PackageTemplates } from "@/components/admin/servicos/package-templates";
import { CombosManager, type ComboRow } from "@/components/admin/servicos/combos-manager";
import { LockedFeatureCard } from "@/components/admin/locked-feature";

export const dynamic = "force-dynamic";

export default async function ServicosPage() {
  const { business } = await requireRoles(["owner", "viewer"]);
  const supabase = createClient();

  const [{ data }, { data: templates }, { data: comboItems }, plan, { data: costRows }] = await Promise.all([
    supabase
      .from("services")
      .select("id, kind, name, description, category, price, duration_min, return_after_days, active, bookable_online, show_in_catalog, sort_order")
      .eq("business_id", business.id)
      .order("active", { ascending: false })
      .order("sort_order"),
    supabase
      .from("package_templates")
      .select("id, name, price, validity_days, active, package_template_items(service_id, sessions, position)")
      .eq("business_id", business.id)
      .order("active", { ascending: false })
      .order("sort_order"),
    supabase.from("combo_items").select("combo_id, service_id, position").eq("business_id", business.id).order("position"),
    getPlanContext(business.id),
    // 69: custo direto (só a matriz e a demo leem; antes da migration, vem vazio)
    supabase.from("service_costs").select("service_id, cost_material, cost_other, cost_override").eq("business_id", business.id),
  ]);
  const costAllowed = allows(plan, "basico");
  type CostRow = { service_id: string; cost_material: number | null; cost_other: number | null; cost_override: number | null };
  const costById = new Map(((costRows ?? []) as CostRow[]).map((c) => [c.service_id, c]));
  const n = (v: number | string | null | undefined) => (v == null ? null : Number(v));
  const all = (data ?? []).map((s) => {
    const c = costById.get(s.id);
    return { ...s, price: Number(s.price), cost_material: n(c?.cost_material), cost_other: n(c?.cost_other), cost_override: n(c?.cost_override) };
  });
  const directCost = (s: { cost_material: number | null; cost_other: number | null }) =>
    s.cost_material == null && s.cost_other == null ? null : (s.cost_material ?? 0) + (s.cost_other ?? 0);
  // combos (32_combos) ficam numa seção própria; a lista e os pacotes são só de serviços
  const services = all.filter((s) => s.kind !== "combo");
  const combos: ComboRow[] = all
    .filter((s) => s.kind === "combo")
    .map((c) => ({
      ...c,
      serviceIds: (comboItems ?? []).filter((i) => i.combo_id === c.id).map((i) => i.service_id as string),
    }));

  return (
    <main className="mx-auto max-w-4xl space-y-8 p-4 md:p-8">
      <header className="text-center">
        <h1 className="text-3xl md:text-4xl">Serviços <Ajuda id="servicos" className="-ml-2" /></h1>
        <p className="mx-auto mt-1 max-w-lg text-sm text-muted-foreground">
          O que você oferece, com preço e duração. A duração define quanto tempo o horário ocupa na agenda.
        </p>
      </header>
      <ServicesManager services={services} costAllowed={costAllowed} />

      {allows(plan, "profissional") ? (
        <CombosManager
          combos={combos}
          costAllowed={costAllowed}
          services={services.map((s) => ({ id: s.id, name: s.name, price: s.price, duration_min: s.duration_min, active: s.active, cost: directCost(s) }))}
        />
      ) : (
        <LockedFeatureCard feature="combos" />
      )}

      {allows(plan, "profissional") ? (
        <PackageTemplates
          templates={(templates ?? []).map(({ package_template_items: items, ...t }) => ({
            ...t,
            price: Number(t.price),
            items: [...(items ?? [])]
              .sort((a, b) => a.position - b.position)
              .map((i) => ({ service_id: i.service_id as string, sessions: i.sessions })),
          }))}
          services={services.filter((s) => s.active).map((s) => ({ id: s.id, name: s.name, price: s.price }))}
        />
      ) : (
        <LockedFeatureCard feature="pacotes" />
      )}
    </main>
  );
}
