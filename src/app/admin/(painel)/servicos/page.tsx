import { createClient } from "@/lib/supabase/server";
import { requireRoles } from "@/lib/admin";
import { ServicesManager } from "@/components/admin/servicos/services-manager";

export const dynamic = "force-dynamic";

export default async function ServicosPage() {
  const { business } = await requireRoles(["owner", "viewer"]);
  const supabase = createClient();

  const { data } = await supabase
    .from("services")
    .select("id, name, description, category, price, duration_min, active, bookable_online, show_in_catalog, sort_order")
    .eq("business_id", business.id)
    .order("active", { ascending: false })
    .order("sort_order");

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-4 md:p-8">
      <header>
        <h1 className="text-3xl md:text-4xl">Serviços</h1>
        <p className="mt-1 max-w-lg text-sm text-muted-foreground">
          O que você oferece, com preço e duração. A duração define quanto tempo o horário ocupa na agenda.
        </p>
      </header>
      <ServicesManager services={(data ?? []).map((s) => ({ ...s, price: Number(s.price) }))} />
    </main>
  );
}
