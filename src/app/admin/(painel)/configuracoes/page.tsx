import { createClient } from "@/lib/supabase/server";
import { requireRoles } from "@/lib/admin";
import { ProfileForm } from "@/components/admin/configuracoes/profile-form";
import { LinkForm } from "@/components/admin/configuracoes/link-form";
import { HoursForm } from "@/components/admin/configuracoes/hours-form";

export const dynamic = "force-dynamic";

type FullBusiness = {
  id: string;
  slug: string;
  name: string;
  segment: string;
  subcategory: string | null;
  tagline: string | null;
  description: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  instagram: string | null;
  hero_image: string | null;
  whatsapp: string | null;
  whatsapp_message: string | null;
  custom_domain: string | null;
  is_published: boolean;
  slot_step_min: number;
  booking_notice_min: number;
};

export default async function ConfiguracoesPage() {
  const { business, role } = await requireRoles(["owner", "viewer"]);
  const b = business as unknown as FullBusiness;
  const supabase = createClient();

  const { data: hours } = await supabase
    .from("business_hours")
    .select("weekday, closed, open_time, close_time")
    .eq("business_id", b.id);

  return (
    <main className="mx-auto max-w-3xl space-y-8 p-4 md:p-8">
      <header>
        <h1 className="text-3xl md:text-4xl">Configurações</h1>
        <p className="mt-1 text-sm text-muted-foreground">Como seu espaço aparece na vitrine e como os clientes agendam.</p>
      </header>

      {role !== "owner" && (
        <p className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          Você pode ver as configurações, mas só o dono do espaço consegue salvar alterações.
        </p>
      )}

      <Section title="Perfil e WhatsApp" description="Informações exibidas na vitrine e no diretório.">
        <ProfileForm key={`p-${b.slug}`} initial={b} />
      </Section>

      <Section title="Link da vitrine" description="O endereço que você divulga no Instagram e no WhatsApp.">
        <LinkForm key={`l-${b.slug}`} initial={{ slug: b.slug, custom_domain: b.custom_domain, is_published: b.is_published }} />
      </Section>

      <Section title="Horários e agendamento" description="Define os horários oferecidos na vitrine.">
        <HoursForm
          initial={(hours ?? []).map((h) => ({
            weekday: h.weekday,
            closed: h.closed,
            open_time: h.open_time ?? "",
            close_time: h.close_time ?? "",
          }))}
          slotStep={b.slot_step_min}
          noticeMin={b.booking_notice_min}
        />
      </Section>
    </main>
  );
}

function Section({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border bg-card p-5 md:p-6">
      <h2 className="text-2xl">{title}</h2>
      <p className="mb-5 mt-1 text-sm text-muted-foreground">{description}</p>
      {children}
    </section>
  );
}
