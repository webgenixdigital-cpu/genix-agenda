// Monta a lista de primeiros passos a partir do que já existe no banco (servidor)
import { createClient } from "@/lib/supabase/server";
import type { PlanContext } from "@/lib/plan";

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
  onboarding?: Record<string, boolean> | null;
  onboarding_dismissed?: boolean;
};

export async function getOnboarding(business: BusinessLike, plan: PlanContext) {
  const supabase = createClient();
  const flags = business.onboarding ?? {};

  const [{ count: services }, { count: pros }, { count: online }] = await Promise.all([
    supabase.from("services").select("id", { count: "exact", head: true }).eq("business_id", business.id).eq("active", true),
    supabase.from("professionals").select("id", { count: "exact", head: true }).eq("business_id", business.id).eq("active", true),
    supabase.from("bookings").select("id", { count: "exact", head: true }).eq("business_id", business.id).eq("source", "online"),
  ]);

  const items: OnboardingItem[] = [
    {
      key: "profile",
      title: "Complete o perfil do seu espaço",
      why: "Uma descrição e uma foto de capa passam confiança para quem chega pela vitrine.",
      done: !!business.description && !!business.hero_image,
      href: "/admin/configuracoes",
      hrefLabel: "Abrir perfil",
    },
    {
      key: "services",
      title: "Cadastre seus serviços",
      why: "É o que o cliente escolhe na hora de agendar. Comece pelos sugeridos e ajuste os preços.",
      done: (services ?? 0) > 0,
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
      href: "/admin/configuracoes",
      hrefLabel: "Ver horários",
      action: "confirm",
      actionLabel: "Já conferi",
      step: "hours",
    },
    {
      key: "team",
      title: "Monte sua equipe",
      why: "Cada profissional tem a própria agenda. Se você atende sozinho(a), é só confirmar.",
      done: (pros ?? 0) > 1 || !!flags.solo,
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
      href: "/admin/configuracoes",
      hrefLabel: "Personalizar",
      action: "confirm",
      actionLabel: "Está ótimo",
      step: "link",
    },
    {
      key: "test",
      title: "Faça um agendamento de teste",
      why: "Veja pelos olhos do cliente como é agendar. Depois é só cancelar na Agenda.",
      done: (online ?? 0) > 0,
      href: `/v/${business.slug}`,
      hrefLabel: "Abrir minha vitrine",
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
          ? `Seu teste do plano Equipe termina em ${plan.trialDaysLeft} ${plan.trialDaysLeft === 1 ? "dia" : "dias"}. Depois, você segue no Grátis se quiser.`
          : "Libere agendamentos ilimitados, bloqueios, financeiro e, no Equipe, os acessos da equipe.",
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
    dismissed: !!business.onboarding_dismissed,
  };
}
