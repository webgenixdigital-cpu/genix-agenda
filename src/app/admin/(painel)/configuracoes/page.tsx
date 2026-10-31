import { createClient } from "@/lib/supabase/server";
import { requireRoles } from "@/lib/admin";
import { ProfileForm } from "@/components/admin/configuracoes/profile-form";
import { getActiveNiches } from "@/lib/niches";
import { LinkForm } from "@/components/admin/configuracoes/link-form";
import { HoursForm } from "@/components/admin/configuracoes/hours-form";
import { WhatsappForm, type WhatsappPanelStatus } from "@/components/admin/configuracoes/whatsapp-form";
import { getPlanContext } from "@/lib/plan";
import { loadFiscal } from "@/lib/faturamento-data";
import { FiscalForm } from "@/components/admin/configuracoes/fiscal-form";
import { ConfirmModeForm } from "@/components/admin/configuracoes/confirm-mode-form";
import { isConfirmMode, type ConfirmMode } from "@/lib/confirm-mode";

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
  online_confirm_mode: string | null;
};

export default async function ConfiguracoesPage() {
  const { business, role } = await requireRoles(["owner", "viewer"]);
  const b = business as unknown as FullBusiness;
  const supabase = createClient();

  const [{ data: hours }, plan, { data: wa }, fiscal] = await Promise.all([
    supabase.from("business_hours").select("weekday, closed, open_time, close_time").eq("business_id", b.id),
    getPlanContext(b.id),
    supabase.rpc("whatsapp_panel_status", { p_business: b.id }),
    loadFiscal(b.id),
  ]);

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
        <ProfileForm key={`p-${b.slug}`} initial={b} niches={await getActiveNiches()} readOnly={role !== "owner"} />
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

      <Section
        id="confirmacao"
        title="Confirmação dos agendamentos online"
        description="Decide se o pedido feito na vitrine já entra confirmado ou espera você confirmar."
      >
        <ConfirmModeForm initial={isConfirmMode(b.online_confirm_mode ?? "") ? (b.online_confirm_mode as ConfirmMode) : "manual"} />
      </Section>

      {/* WhatsApp automático (beta): só aparece para espaço liberado pela Genix, num plano pago */}
      {plan.tier === "completo" && (wa as WhatsappPanelStatus | null)?.genix_enabled && (
        <Section
          id="whatsapp"
          title="WhatsApp automático (beta)"
          description="Lembrete de véspera enviado sozinho do WhatsApp do seu espaço."
        >
          <WhatsappForm initial={wa as WhatsappPanelStatus} businessName={b.name} canEdit={role === "owner"} />
        </Section>
      )}

      <Section
        id="enquadramento"
        title="Enquadramento e faturamento"
        description="Usado para acompanhar os limites de faturamento e montar o relatório para o contador."
      >
        <FiscalForm initial={fiscal} />
      </Section>
    </main>
  );
}

function Section({
  id,
  title,
  description,
  children,
}: {
  id?: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-4 rounded-2xl border bg-card p-5 md:p-6">
      <h2 className="text-2xl">{title}</h2>
      <p className="mb-5 mt-1 text-sm text-muted-foreground">{description}</p>
      {children}
    </section>
  );
}
