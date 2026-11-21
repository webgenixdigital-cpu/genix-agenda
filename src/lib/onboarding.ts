// Monta a lista de primeiros passos a partir do que já existe no banco (servidor)
import { createClient } from "@/lib/supabase/server";
import type { PlanContext } from "@/lib/plan";
import { planAllows } from "@/lib/plan-features";
import { FREE_MONTHS, PLAN_PROMISE } from "@/content/planos";

export type OnboardingAction = "link" | "confirm" | "suggest" | "solo" | "copy";

export type OnboardingItem = {
  key: string;
  title: string;
  why: string;
  done: boolean;
  optional?: boolean;
  /** botão principal: leva a uma tela */
  href?: string;
  hrefLabel?: string;
  /** botão secundário */
  action?: Exclude<OnboardingAction, "link">;
  actionLabel?: string;
  step?: "hours" | "solo" | "link" | "shared";
};

type BusinessLike = {
  id: string;
  slug: string;
  description?: string | null;
  hero_image?: string | null;
  whatsapp?: string | null;
  onboarding?: Record<string, boolean> | null;
};

export type OnboardingCounts = { services: number; pros: number; online: number };

/** Contagens usadas pela configuração inicial e pelo quadro "Falta configurar" (uma rodada) */
export async function loadOnboardingCounts(businessId: string): Promise<OnboardingCounts> {
  const supabase = createClient();
  const [{ count: services }, { count: pros }, { count: online }] = await Promise.all([
    supabase.from("services").select("id", { count: "exact", head: true }).eq("business_id", businessId).eq("active", true),
    supabase.from("professionals").select("id", { count: "exact", head: true }).eq("business_id", businessId).eq("active", true),
    supabase.from("bookings").select("id", { count: "exact", head: true }).eq("business_id", businessId).eq("source", "online"),
  ]);
  return { services: services ?? 0, pros: pros ?? 0, online: online ?? 0 };
}

export async function getOnboarding(business: BusinessLike, plan: PlanContext) {
  return buildOnboarding(business, plan, await loadOnboardingCounts(business.id));
}

export function buildOnboarding(business: BusinessLike, plan: PlanContext, counts: OnboardingCounts) {
  const flags = business.onboarding ?? {};
  const { services, pros, online } = counts;

  const items: OnboardingItem[] = [
    {
      key: "profile",
      title: "Complete o perfil do seu espaço",
      why: "Uma descrição e uma foto de capa passam confiança para quem chega pela vitrine.",
      done: !!business.description && !!business.hero_image,
      href: "/admin/configuracoes#perfil",
      hrefLabel: "Abrir perfil",
    },
    {
      key: "services",
      title: "Cadastre seus serviços",
      why: "É o que o cliente escolhe na hora de agendar. Comece pelos sugeridos e ajuste os preços.",
      done: services > 0,
      href: "/admin/servicos",
      hrefLabel: "Cadastrar",
      action: "suggest",
      actionLabel: "Adicionar sugeridos",
    },
    {
      key: "hours",
      title: "Confira seus horários de funcionamento",
      why: "A vitrine só oferece horários dentro do seu expediente.",
      done: !!flags.hours,
      href: "/admin/configuracoes#horarios",
      hrefLabel: "Ver horários",
      action: "confirm",
      actionLabel: "Já conferi",
      step: "hours",
    },
    {
      key: "team",
      title: "Monte sua equipe",
      why: "Cada profissional tem a própria agenda. Se você atende sozinho(a), é só confirmar.",
      done: pros > 1 || !!flags.solo,
      href: "/admin/profissionais",
      hrefLabel: "Abrir equipe",
      action: "solo",
      actionLabel: "Trabalho sozinho(a)",
      step: "solo",
    },
    {
      key: "link",
      title: "Confira o link da sua vitrine",
      why: `Hoje ele é /v/${business.slug}. Curto e fácil de digitar ajuda o cliente a lembrar.`,
      done: !!flags.link,
      href: "/admin/configuracoes#link",
      hrefLabel: "Personalizar",
      action: "confirm",
      actionLabel: "Está ótimo",
      step: "link",
    },
    // 59: no Grátis e no Básico o link é um cartão de visita (sem agendamento online)
    planAllows(plan.kind, "profissional")
      ? {
          key: "test",
          title: "Faça um agendamento de teste",
          why: "Veja pelos olhos do cliente como é agendar. Depois é só cancelar na Agenda.",
          done: online > 0,
          href: `/v/${business.slug}`,
          hrefLabel: "Abrir minha vitrine",
        }
      : {
          key: "test",
          title: "Confira seu cartão de visita",
          why: PLAN_PROMISE.card,
          done: false,
          optional: true,
          href: `/v/${business.slug}`,
          hrefLabel: "Abrir meu link",
        },
    {
      key: "share",
      title: "Divulgue seu link",
      why: "Coloque na bio do Instagram e no status do WhatsApp. É assim que os pedidos começam a chegar.",
      done: !!flags.shared,
      action: "copy",
      actionLabel: "Copiar link",
      step: "shared",
    },
    {
      key: "plan",
      title: "Escolha seu plano",
      why:
        plan.trialDaysLeft !== null
          ? `Seu teste do plano Equipe termina em ${plan.trialDaysLeft} ${plan.trialDaysLeft === 1 ? "dia" : "dias"}. Depois, você pode seguir no Grátis por ${FREE_MONTHS} meses (agenda interna e cartão de visita).`
          : `Básico: agenda sem prazo, encaixe, bloqueios e financeiro. ${PLAN_PROMISE.vitrineFrom}.`,
      done: plan.status === "active",
      optional: true,
      href: "/admin/assinatura",
      hrefLabel: "Ver planos",
    },
  ];

  const required = items.filter((i) => !i.optional);
  return {
    items,
    doneCount: required.filter((i) => i.done).length,
    total: required.length,
  };
}

export type SetupGap = { key: string; label: string; href: string };

/**
 * Quadro "Falta configurar" do Início: o que ainda está sem informação, na ordem em que
 * aparece em Configurações, com as mesmas regras da configuração inicial.
 * `fiscalRegime` undefined = não conferir o enquadramento (Grátis não tem caixa).
 */
export function setupGaps(business: BusinessLike, counts: OnboardingCounts, fiscalRegime?: string | null): SetupGap[] {
  const flags = business.onboarding ?? {};
  const gaps: (SetupGap | false)[] = [
    !business.hero_image && { key: "capa", label: "foto de capa", href: "/admin/configuracoes#perfil" },
    !business.description && { key: "descricao", label: "descrição", href: "/admin/configuracoes#perfil" },
    !business.whatsapp && { key: "whatsapp", label: "WhatsApp do espaço", href: "/admin/configuracoes#perfil" },
    !flags.hours && { key: "horarios", label: "horários", href: "/admin/configuracoes#horarios" },
    counts.services === 0 && { key: "servicos", label: "serviços", href: "/admin/servicos" },
    fiscalRegime === null && { key: "enquadramento", label: "enquadramento", href: "/admin/configuracoes#enquadramento" },
  ];
  return gaps.filter((g): g is SetupGap => !!g);
}
