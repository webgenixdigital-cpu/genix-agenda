import Link from "next/link";
import { Gift, Sparkles } from "lucide-react";
import type { PlanContext } from "@/lib/plan";
import { cn } from "@/lib/utils";

export function PlanBanner({ plan }: { plan: PlanContext }) {
  if (plan.internal || plan.status === "active") return null;

  // Teste do Completo valendo
  if (plan.trialDaysLeft !== null) {
    const urgent = plan.trialDaysLeft <= 3;
    const days = plan.trialDaysLeft === 1 ? "falta 1 dia" : `faltam ${plan.trialDaysLeft} dias`;
    return (
      <div
        className={cn(
          "flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b px-4 py-2.5 text-sm md:px-8",
          urgent ? "border-amber-300 bg-amber-50 text-amber-900" : "bg-secondary text-foreground"
        )}
        data-testid="faixa-teste"
      >
        <p className="flex items-center gap-2">
          <Gift className="h-4 w-4 shrink-0 text-primary" />
          <span>
            <strong>Teste do Completo:</strong> {days}.
            {urgent && " Depois, sua conta passa para o plano Grátis."}
          </span>
        </p>
        <Link href="/admin/assinatura" className="font-semibold text-primary underline" data-testid="link-faixa-planos">
          Ver planos
        </Link>
      </div>
    );
  }

  // Plano Grátis
  if (plan.tier === "gratis") {
    return (
      <div
        className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b bg-secondary px-4 py-2.5 text-sm md:px-8"
        data-testid="faixa-gratis"
      >
        <p className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 shrink-0 text-primary" />
          <span>
            <strong>Plano Grátis:</strong> até 10 agendamentos online por dia e 1 profissional.
          </span>
        </p>
        <Link href="/admin/assinatura" className="font-semibold text-primary underline" data-testid="link-faixa-liberar">
          Liberar o Completo
        </Link>
      </div>
    );
  }

  return null;
}
