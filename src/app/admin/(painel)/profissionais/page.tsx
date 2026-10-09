import { createClient } from "@/lib/supabase/server";
import { getAdminContext } from "@/lib/admin";
import { TeamManager } from "@/components/admin/profissionais/team-manager";

export const dynamic = "force-dynamic";

export default async function ProfissionaisPage() {
  const { business } = await getAdminContext();
  const supabase = createClient();

  const [{ data: pros }, { data: services }] = await Promise.all([
    supabase
      .from("professionals")
      .select("id, name, role, bio, photo_url, specialties, commission_pct, active, sort_order, professional_services(service_id)")
      .eq("business_id", business.id)
      .order("active", { ascending: false })
      .order("sort_order"),
    supabase
      .from("services")
      .select("id, name, category")
      .eq("business_id", business.id)
      .eq("active", true)
      .order("sort_order"),
  ]);

  const team = (pros ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    role: p.role,
    bio: p.bio,
    photo_url: p.photo_url,
    specialties: p.specialties ?? [],
    commission_pct: Number(p.commission_pct),
    active: p.active,
    serviceIds: ((p.professional_services ?? []) as { service_id: string }[]).map((l) => l.service_id),
  }));

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-4 md:p-8">
      <header>
        <h1 className="text-3xl md:text-4xl">Equipe</h1>
        <p className="mt-1 max-w-lg text-sm text-muted-foreground">
          Quem atende no seu espaço e quais serviços cada pessoa faz. Isso define os horários oferecidos na vitrine.
        </p>
      </header>
      <TeamManager team={team} services={services ?? []} />
    </main>
  );
}