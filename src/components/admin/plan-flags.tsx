"use client";

// Travas do plano que os botões do painel precisam saber (migration 59).
// O banco é a fonte da verdade (gatilho guard_free_read_only, submit_review);
// aqui só escondemos o que não vai funcionar.
import { createContext, useContext } from "react";
import Link from "next/link";
import { Lock } from "lucide-react";
import { cn } from "@/lib/utils";

export type PlanFlags = {
  /** Grátis vencido: painel só consulta (agendamentos e clientes); cancelar continua liberado */
  readOnly: boolean;
  /** pedido de avaliação depois do atendimento (Profissional e Equipe) */
  reviewRequest: boolean;
};

const PlanFlagsCtx = createContext<PlanFlags>({ readOnly: false, reviewRequest: true });

export function PlanFlagsProvider({ value, children }: { value: PlanFlags; children: React.ReactNode }) {
  return <PlanFlagsCtx.Provider value={value}>{children}</PlanFlagsCtx.Provider>;
}

export const usePlanFlags = () => useContext(PlanFlagsCtx);

/** Botão travado do "só consulta": leva para a Assinatura (Básico) */
export function ReadOnlyLink({ label, testid, className }: { label: string; testid: string; className?: string }) {
  return (
    <Link
      href="/admin/assinatura"
      className={cn(
        "inline-flex h-11 items-center justify-center gap-1.5 rounded-md border border-dashed px-4 text-sm font-medium text-muted-foreground hover:bg-secondary",
        className
      )}
      title="Painel só para consulta: assine o Básico para continuar"
      data-testid={testid}
    >
      <Lock className="h-4 w-4" aria-hidden /> {label}
      <span className="sr-only"> (painel só para consulta: assine o Básico)</span>
    </Link>
  );
}
