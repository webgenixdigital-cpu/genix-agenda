import Link from "next/link";
import { AlertTriangle, Gift, Sparkles } from "lucide-react";
import { PLAN_NAMES, recommendedKind, type PlanContext } from "@/lib/plan";
import { PLAN_PROMISE } from "@/content/planos";
import { cn } from "@/lib/utils";

export function PlanBanner({
  plan,
  activePros,
}: {
  plan: PlanContext;
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
            {urgent && ` Para continuar com tudo, inclusive a vitrine de agendamento online, assine o ${PLAN_NAMES[offer]}; senão, sua conta passa para o Grátis (agenda interna e cartão de visita).`}
          </span>
        </p>
        <Link href="/admin/assinatura" className="font-semibold text-primary underline" data-testid="link-faixa-planos">
          {urgent ? `Continuar no ${PLAN_NAMES[offer]}` : "Ver planos"}
        </Link>
      </div>
    );
  }

  // Grátis vencido (59): painel só consulta
  if (plan.tier === "gratis" && plan.freeOver) {
    return (
      <div
        className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 border-b border-amber-300 bg-amber-50 px-4 py-2.5 text-center text-sm text-amber-900 md:px-8"
        data-testid="faixa-gratis-encerrado"
      >
        <p className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>
            <strong>{PLAN_PROMISE.freeOverTitle}</strong> {PLAN_PROMISE.freeOverPanel}
          </span>
        </p>
        <Link href="/admin/assinatura" className="font-semibold text-primary underline" data-testid="link-faixa-assinar-basico">
          Assinar o Básico
        </Link>
      </div>
    );
  }

  // Plano Grátis
  if (plan.tier === "gratis") {
    const soon = plan.freeDaysLeft !== null && plan.freeDaysLeft <= 15;
    return (
      <div
        className={cn(
          "flex flex-wrap items-center justify-center gap-x-4 gap-y-2 border-b px-4 py-2.5 text-center text-sm md:px-8",
          soon ? "border-amber-300 bg-amber-50 text-amber-900" : "bg-secondary"
        )}
        data-testid="faixa-gratis"
      >
        <p className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 shrink-0 text-primary" />
          <span>
            <strong>Plano Grátis:</strong> agenda interna e cartão de visita, 1 profissional
            {plan.freeDaysLeft !== null ? ` · ${plan.freeDaysLeft === 1 ? "falta 1 dia" : `faltam ${plan.freeDaysLeft} dias`}` : ""}.
          </span>
        </p>
        <Link href="/admin/assinatura" className="font-semibold text-primary underline" data-testid="link-faixa-liberar">
          {soon ? "Assinar o Básico" : "Ver planos pagos"}
        </Link>
      </div>
    );
  }

  return null;
}
