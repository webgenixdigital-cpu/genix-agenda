"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { dismissConfirmIntro } from "@/app/admin/(painel)/configuracoes/actions";
import { Button } from "@/components/ui/button";

/** Apresenta a confirmação automática às contas que já existiam (modo manual, dono nunca escolheu) */
export function ConfirmIntroCard() {
  const [hidden, setHidden] = useState(false);
  const [pending, start] = useTransition();
  if (hidden) return null;

  function dismiss() {
    start(async () => {
      const r = await dismissConfirmIntro();
      if (!r) return; // demonstração: o servidor redirecionou
      if (r.ok) setHidden(true);
      else toast.error(r.error);
    });
  }

  return (
    <section className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-primary/30 bg-primary/5 p-5" data-testid="aviso-confirmacao-automatica">
      <div className="flex gap-3">
        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
        <div>
          <p className="font-semibold">Novo: confirmação automática dos agendamentos online</p>
          <p className="text-sm text-muted-foreground">
            Hoje você confirma cada pedido da vitrine. Se quiser, clientes que já foram atendidos aqui (ou todos) podem
            entrar confirmados sozinhos.
          </p>
        </div>
      </div>
      <div className="flex gap-2">
        <Button variant="ghost" className="h-11" onClick={dismiss} disabled={pending} data-testid="btn-dispensar-confirmacao">
          Agora não
        </Button>
        <Button asChild className="h-11" data-testid="btn-configurar-confirmacao">
          <Link href="/admin/configuracoes#confirmacao">Configurar</Link>
        </Button>
      </div>
    </section>
  );
}
