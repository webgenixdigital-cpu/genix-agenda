import Link from "next/link";
import { Gift, Sparkles } from "lucide-react";
import { PLAN_NAMES, recommendedKind, type PlanContext } from "@/lib/plan";
import { cn } from "@/lib/utils";

export function PlanBanner({
  plan,
  freeLimit,
  activePros,
}: {
  plan: PlanContext;
  /** agendamentos online por dia no Grátis (vem do banco) */
  freeLimit: number;
  /** profissionais ativos: define a oferta do fim do teste */
  activePros: number;
}) {
  if (plan.internal || plan.status === "active") return null;

  // Teste do Equipe valendo
  if (plan.trialDaysLeft !== null) {
    const urgent = plan.trialDaysLeft <= 3;
    const days = plan.trialDaysLeft === 1 ? "falta 1 dia" : `faltam ${plan.trialDaysLeft} dias`;
    const offer = recommendedKind(activePros);
    return (
      <div
        className={cn(
          "flex flex-wrap items-center justify-center gap-x-4 gap-y-2 border-b px-4 py-2.5 text-center text-sm md:px-8",
          urgent ? "border-amber-300 bg-amber-50 text-amber-900" : "bg-secondary text-foreground"
        )}
        data-testid="faixa-teste"
      >
        <p className="flex items-center gap-2">
          <Gift className="h-4 w-4 shrink-0 text-primary" />
          <span>
            <strong>Teste grátis do plano Equipe:</strong> {days}.
            {urgent && ` Para continuar com tudo, assine o ${PLAN_NAMES[offer]}; senão, sua conta passa para o Grátis.`}
          </span>
        </p>
        <Link href="/admin/assinatura" className="font-semibold text-primary underline" data-testid="link-faixa-planos">
          {urgent ? `Continuar no ${PLAN_NAMES[offer]}` : "Ver planos"}
        </Link>
      </div>
    );
  }

  // Plano Grátis
  if (plan.tier === "gratis") {
    return (
      <div
        className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 border-b bg-secondary px-4 py-2.5 text-center text-sm md:px-8"
        data-testid="faixa-gratis"
      >
        <p className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 shrink-0 text-primary" />
          <span>
            <strong>Plano Grátis:</strong> até {freeLimit} agendamentos online por dia e 1 profissional.
          </span>
        </p>
        <Link href="/admin/assinatura" className="font-semibold text-primary underline" data-testid="link-faixa-liberar">
          Ver planos pagos
        </Link>
      </div>
    );
  }

  return null;
}
