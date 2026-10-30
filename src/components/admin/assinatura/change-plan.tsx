"use client";

// Troca entre Profissional e Equipe para quem já assina (mesmo ciclo).
import { useTransition } from "react";
import { ArrowDownRight, ArrowUpRight, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cancelPlanChange, changePlan } from "@/app/admin/(painel)/assinatura/actions";
import { Button } from "@/components/ui/button";
import { brl } from "@/lib/format";
import type { PaidPlanId } from "@/lib/plan-ids";

export function ChangePlanButton({
  target,
  direction,
  price,
  cycle,
  blockedReason,
}: {
  target: PaidPlanId;
  direction: "up" | "down";
  /** valor do plano de destino no mesmo ciclo */
  price: number;
  cycle: "mensal" | "anual";
  /** motivo para não permitir (ex.: Profissional com 2+ ativos) */
  blockedReason?: string;
}) {
  const [pending, start] = useTransition();
  const up = direction === "up";
  const per = cycle === "anual" ? "/ano" : "/mês";

  function run() {
    const text = up
      ? cycle === "anual"
        ? `Mudar para o Equipe (${brl(price)}${per})? Vamos gerar uma cobrança só da diferença proporcional aos dias que faltam; o Equipe é liberado quando ela for paga.`
        : `Mudar para o Equipe agora? O novo valor (${brl(price)}${per}) vale a partir da próxima cobrança.`
      : `Mudar para o Profissional (${brl(price)}${per}) na próxima renovação? Até lá, você continua no Equipe. Depois, os acessos da equipe ficam pausados (nada é apagado).`;
    if (!confirm(text)) return;
    start(async () => {
      const r = await changePlan(target);
      if (!r) return; // demonstração: o servidor redirecionou
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      if (r.invoiceUrl) window.location.href = r.invoiceUrl;
      else toast.success(r.message ?? "Feito.");
    });
  }

  return (
    <div className="space-y-1">
      <Button
        variant={up ? "default" : "outline"}
        className="h-11"
        disabled={pending || !!blockedReason}
        onClick={run}
        data-testid={up ? "btn-mudar-equipe" : "btn-mudar-profissional"}
      >
        {pending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : up ? (
          <>
            <ArrowUpRight className="mr-1.5 h-4 w-4" /> Mudar para o Equipe
          </>
        ) : (
          <>
            <ArrowDownRight className="mr-1.5 h-4 w-4" /> Mudar para o Profissional
          </>
        )}
      </Button>
      {blockedReason && <p className="text-xs text-muted-foreground">{blockedReason}</p>}
    </div>
  );
}

export function CancelPlanChangeButton({ label }: { label: string }) {
  const [pending, start] = useTransition();
  return (
    <Button
      variant="ghost"
      className="h-11"
      disabled={pending}
      data-testid="btn-desistir-troca"
      onClick={() => {
        if (!confirm("Desistir da troca de plano?")) return;
        start(async () => {
          const r = await cancelPlanChange();
          if (!r) return;
          if (r.ok) toast.success("Troca desfeita.");
          else toast.error(r.error);
        });
      }}
    >
      {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : label}
    </Button>
  );
}
