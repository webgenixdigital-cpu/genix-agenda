import { createClient } from "@/lib/supabase/server";
import { requireRoles } from "@/lib/admin";
import { getPlanContext } from "@/lib/plan";
import { ServicesManager } from "@/components/admin/servicos/services-manager";
import { PackageTemplates } from "@/components/admin/servicos/package-templates";
import { CombosManager, type ComboRow } from "@/components/admin/servicos/combos-manager";
import { LockedFeatureCard } from "@/components/admin/locked-feature";

export const dynamic = "force-dynamic";

export default async function ServicosPage() {
  const { business } = await requireRoles(["owner", "viewer"]);
  const supabase = createClient();

  const [{ data }, { data: templates }, { data: comboItems }, plan] = await Promise.all([
    supabase
      .from("services")
      .select("id, kind, name, description, category, price, duration_min, return_after_days, active, bookable_online, show_in_catalog, sort_order")
      .eq("business_id", business.id)
      .order("active", { ascending: false })
      .order("sort_order"),
    supabase
      .from("package_templates")
      .select("id, service_id, name, sessions, price, validity_days, active")
      .eq("business_id", business.id)
      .order("active", { ascending: false })
      .order("sort_order"),
    supabase.from("combo_items").select("combo_id, service_id, position").eq("business_id", business.id).order("position"),
    getPlanContext(business.id),
  ]);
  const all = (data ?? []).map((s) => ({ ...s, price: Number(s.price) }));
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
        <h1 className="text-3xl md:text-4xl">Serviços</h1>
        <p className="mx-auto mt-1 max-w-lg text-sm text-muted-foreground">
          O que você oferece, com preço e duração. A duração define quanto tempo o horário ocupa na agenda.
        </p>
      </header>
      <ServicesManager services={services} />

      {plan.tier === "completo" ? (
        <CombosManager
          combos={combos}
          services={services.map((s) => ({ id: s.id, name: s.name, price: s.price, duration_min: s.duration_min, active: s.active }))}
        />
      ) : (
        <LockedFeatureCard feature="combos" />
      )}

      {plan.tier === "completo" ? (
        <PackageTemplates
          templates={(templates ?? []).map((t) => ({ ...t, price: Number(t.price) }))}
          services={services.filter((s) => s.active).map((s) => ({ id: s.id, name: s.name, price: s.price }))}
        />
      ) : (
        <LockedFeatureCard feature="pacotes" />
      )}
    </main>
  );
}
