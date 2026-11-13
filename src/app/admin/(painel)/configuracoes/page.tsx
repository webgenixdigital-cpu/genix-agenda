import { createClient } from "@/lib/supabase/server";
import { requireRoles } from "@/lib/admin";
import { ProfileForm } from "@/components/admin/configuracoes/profile-form";
import { getActiveNiches } from "@/lib/niches";
import { LinkForm } from "@/components/admin/configuracoes/link-form";
import { HoursForm } from "@/components/admin/configuracoes/hours-form";
import { WhatsappForm, type WhatsappPanelStatus } from "@/components/admin/configuracoes/whatsapp-form";
import { getPlanContext } from "@/lib/plan";
import { defaultProviderName } from "@/lib/whatsapp/provider";
import { queueV2Enabled } from "@/lib/whatsapp/queue";
import type { WhatsappStats } from "@/components/admin/configuracoes/whatsapp-messages";
import { loadFiscal } from "@/lib/faturamento-data";
import { FiscalForm } from "@/components/admin/configuracoes/fiscal-form";
import { ConfirmModeForm } from "@/components/admin/configuracoes/confirm-mode-form";
import { DiscountForm } from "@/components/admin/configuracoes/discount-form";
import { CONFIRM_MODES, isConfirmMode, type ConfirmMode } from "@/lib/confirm-mode";
import { REGIME_LABEL } from "@/lib/faturamento";
import { hoursSummary } from "@/lib/settings-summary";
import { SettingsAccordion, type SettingsSection } from "@/components/admin/configuracoes/settings-accordion";
import { getOnboarding } from "@/lib/onboarding";
import { ReviewOnboardingLink } from "@/components/admin/configuracoes/review-onboarding-link";

export const dynamic = "force-dynamic";
// criar a instância da Evolution espera o primeiro QR (~5 s + rede)
export const maxDuration = 30;

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
  staff_discount_max_pct: number | string | null;
};

export default async function ConfiguracoesPage() {
  const { business, role } = await requireRoles(["owner", "viewer"]);
  const b = business as unknown as FullBusiness;
  const supabase = createClient();

  const [{ data: hours }, plan, { data: wa }, fiscal, { data: waStats }] = await Promise.all([
    supabase.from("business_hours").select("weekday, closed, open_time, close_time").eq("business_id", b.id),
    getPlanContext(b.id),
    supabase.rpc("whatsapp_panel_status", { p_business: b.id }),
    loadFiscal(b.id),
    // 42: números dos últimos 7 dias por tipo (antes da migration: erro → sem o cartão)
    supabase.rpc("whatsapp_auto_stats", { p_business: b.id }),
  ]);

  // "Rever configuração inicial" só quando o cartão do Início teria algo a mostrar
  const onboarding = role === "viewer" || !plan.internal ? await getOnboarding(business as never, plan) : null;
  const canReviewOnboarding = !!onboarding && onboarding.doneCount < onboarding.total;

  const waPanel = (wa as WhatsappPanelStatus | null) ?? null;
  // instância da Evolution, ou conexão nova com WHATSAPP_PROVIDER=evolution (Z-API já cadastrada continua Z-API)
  const waEvolution =
    waPanel?.provider === "evolution" ||
    (defaultProviderName() === "evolution" && !(waPanel?.provider === "zapi" && waPanel.has_instance));

  const confirmMode: ConfirmMode = isConfirmMode(b.online_confirm_mode ?? "") ? (b.online_confirm_mode as ConfirmMode) : "manual";
  const discount = Number(b.staff_discount_max_pct ?? 0);
  const hourRows = (hours ?? []).map((h) => ({
    weekday: h.weekday,
    closed: h.closed,
    open_time: h.open_time ?? "",
    close_time: h.close_time ?? "",
  }));
  const showWhatsapp = plan.tier === "completo" && !!waPanel && (waEvolution || waPanel.genix_enabled);
  const waStatus = waPanel?.status === "connected" ? "conectado" : waPanel?.status === "disconnected" ? "desconectado" : "não conectado";

  const sections: SettingsSection[] = [
    {
      id: "perfil",
      title: "Perfil e WhatsApp",
      summary: [b.name, [b.city, b.state].filter(Boolean).join("/")].filter(Boolean).join(" · "),
      description: "Informações exibidas na vitrine e no diretório.",
      content: <ProfileForm key={`p-${b.slug}`} initial={b} niches={await getActiveNiches()} readOnly={role !== "owner"} />,
    },
    {
      id: "link",
      title: "Link da vitrine",
      summary: `/v/${b.slug} · ${b.is_published ? "publicada" : "não publicada"}`,
      description: "O endereço que você divulga no Instagram e no WhatsApp.",
      content: <LinkForm key={`l-${b.slug}`} initial={{ slug: b.slug, custom_domain: b.custom_domain, is_published: b.is_published }} />,
    },
    {
      id: "horarios",
      title: "Horários e agendamento",
      summary: hoursSummary(hourRows),
      description: "Define os horários oferecidos na vitrine.",
      content: <HoursForm initial={hourRows} slotStep={b.slot_step_min} noticeMin={b.booking_notice_min} />,
    },
    {
      id: "confirmacao",
      title: "Confirmação dos agendamentos online",
      summary: CONFIRM_MODES.find((m) => m.value === confirmMode)?.label ?? "",
      description: "Decide se o pedido feito na vitrine já entra confirmado ou espera você confirmar.",
      content: <ConfirmModeForm initial={confirmMode} />,
    },
    {
      id: "descontos",
      title: "Descontos",
      summary: discount > 0 ? `profissional pode dar até ${discount}%` : "profissional sem desconto",
      description: "Quanto o profissional pode descontar ao editar um agendamento.",
      content: <DiscountForm initial={discount} readOnly={role !== "owner"} />,
    },
    // WhatsApp automático (beta), num plano pago. Evolution: o dono conecta pelo QR antes
    // da liberação da Genix (sem ela nada é enviado). Z-API: só depois da liberação.
    ...(showWhatsapp && waPanel
      ? [
          {
            id: "whatsapp",
            title: "WhatsApp automático (beta)",
            summary: `${waStatus}, envio ${waPanel.auto_enabled ? "ligado" : "desligado"}`,
            description: "Confirmação, lembretes e parabéns enviados sozinhos do WhatsApp do seu espaço.",
            content: (
              <WhatsappForm
                initial={waPanel}
                selfConnect={waEvolution}
                businessName={b.name}
                canEdit={role === "owner"}
                queueV2={queueV2Enabled()}
                stats={(waStats as WhatsappStats | null) ?? null}
              />
            ),
          },
        ]
      : []),
    {
      id: "enquadramento",
      title: "Enquadramento e faturamento",
      summary: fiscal.regime ? REGIME_LABEL[fiscal.regime] : "não definido",
      description: "Usado para acompanhar os limites de faturamento e montar o relatório para o contador.",
      content: <FiscalForm initial={fiscal} />,
    },
  ];

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-4 md:space-y-8 md:p-8">
      <header className="text-center">
        <h1 className="text-3xl md:text-4xl">Configurações</h1>
        <p className="mt-1 text-sm text-muted-foreground">Como seu espaço aparece na vitrine e como os clientes agendam.</p>
        {canReviewOnboarding && <ReviewOnboardingLink />}
      </header>

      {role !== "owner" && (
        <p className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-center text-sm text-amber-900">
          Você pode ver as configurações, mas só o dono do espaço consegue salvar alterações.
        </p>
      )}

      <SettingsAccordion sections={sections} />
    </main>
  );
}
