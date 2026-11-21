// Aviso do cartão de visita (Grátis e Básico, migration 59): o link mostra serviços, preços,
// avaliações e o botão do WhatsApp; a vitrine com agendamento online vem no Profissional.
// Textos em src/content/planos.ts (PLAN_PROMISE).
import Link from "next/link";
import { Lock, MessageCircle } from "lucide-react";
import { PLAN_PROMISE, planNote } from "@/content/planos";
import { cn } from "@/lib/utils";

export function VitrinePlanNote({ className, compact }: { className?: string; compact?: boolean }) {
  return (
    <div className={cn("rounded-xl border border-dashed bg-secondary/40 p-4 text-sm", className)} data-testid="aviso-cartao-de-visita">
      <p className="flex items-center gap-2 font-semibold">
        <MessageCircle className="h-4 w-4 shrink-0 text-whatsapp" aria-hidden /> Seu link é um cartão de visita
      </p>
      {!compact && <p className="copy mt-1 text-muted-foreground">{PLAN_PROMISE.card}</p>}
      <p className="copy mt-2 text-muted-foreground">
        <Lock className="mr-1 inline h-3.5 w-3.5 align-[-2px] text-primary" aria-hidden />
        {PLAN_PROMISE.vitrineUpsell} {planNote("vitrine")}
      </p>
      <Link
        href="/admin/assinatura"
        className="tap-target mt-1 inline-flex items-center font-semibold text-primary underline-offset-4 hover:underline"
        data-testid="link-vitrine-completa"
      >
        Ver o plano Profissional
      </Link>
    </div>
  );
}
