import { createClient } from "@/lib/supabase/server";
import { requireRoles } from "@/lib/admin";
import { getPlanContext } from "@/lib/plan";
import { TeamManager } from "@/components/admin/profissionais/team-manager";
import { ReceptionSection, type AccessInfo } from "@/components/admin/profissionais/team-access";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadFiscal } from "@/lib/faturamento-data";

export const dynamic = "force-dynamic";

export default async function ProfissionaisPage() {
  const { business, role, userId } = await requireRoles(["owner", "viewer"]);
  const plan = await getPlanContext(business.id);
  const supabase = createClient();

  const [{ data: pros }, { data: services }, fiscal] = await Promise.all([
    supabase
      .from("professionals")
      .select("id, name, role, bio, photo_url, specialties, commission_pct, is_partner, active, sort_order, user_id, professional_services(service_id)")
      .eq("business_id", business.id)
      .order("active", { ascending: false })
      .order("sort_order"),
    supabase
      .from("services")
      .select("id, name, category")
      .eq("business_id", business.id)
      .eq("active", true)
      .order("sort_order"),
    loadFiscal(business.id),
  ]);

  const team = (pros ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    role: p.role,
    bio: p.bio,
    photo_url: p.photo_url,
    specialties: p.specialties ?? [],
    commission_pct: Number(p.commission_pct),
    is_partner: !!p.is_partner,
    active: p.active,
    user_id: p.user_id,
    serviceIds: ((p.professional_services ?? []) as { service_id: string }[]).map((l) => l.service_id),
  }));

  // ---------------------------------------------------------------
  // Acessos da equipe (só a matriz vê; e-mails vêm do login de cada um)
  // ---------------------------------------------------------------
  const access: Record<string, AccessInfo> = {};
  const reception: AccessInfo[] = [];
  const isOwner = role === "owner";

  if (isOwner) {
    const admin = createAdminClient();
    const { data: members } = await admin
      .from("business_members")
      .select("user_id, role, invited_email, display_name")
      .eq("business_id", business.id)
      .in("role", ["staff", "reception"]);

    for (const m of members ?? []) {
      const { data: u } = await admin.auth.admin.getUserById(m.user_id);
      const info: AccessInfo = {
        userId: m.user_id,
        email: m.invited_email ?? u.user?.email ?? "",
        name: m.display_name ?? (u.user?.user_metadata?.full_name as string | undefined) ?? "Sem nome",
        role: m.role as AccessInfo["role"],
        status: u.user?.last_sign_in_at ? "active" : "pending",
      };
      if (m.role === "reception") reception.push(info);
      else {
        const pro = team.find((p) => p.user_id === m.user_id);
        if (pro) access[pro.id] = info;
      }
    }
  }
  const canInvite = isOwner && plan.tier === "completo";

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-4 md:p-8">
      <header>
        <h1 className="text-3xl md:text-4xl">Equipe</h1>
        <p className="mt-1 max-w-lg text-sm text-muted-foreground">
          Quem atende no seu espaço e quais serviços cada pessoa faz. Isso define os horários oferecidos na vitrine.
        </p>
      </header>
      <TeamManager
        team={team}
        services={services ?? []}
        canAddMore={plan.tier === "completo" || !team.some((p) => p.active)}
        access={access}
        ownerUserId={isOwner ? userId : undefined}
        canInvite={canInvite}
        partnerSalon={fiscal.partner_salon}
        businessId={business.id}
        readOnly={!isOwner}
      />
      {isOwner && <ReceptionSection members={reception} canInvite={canInvite} />}
    </main>
  );
}
