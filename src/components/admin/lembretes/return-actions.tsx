"use client";

import { useTransition } from "react";
import { MessageCircle, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { markReturnContacted } from "@/app/admin/(painel)/lembretes/actions";
import { Button } from "@/components/ui/button";

export function SendReturnButton({ id, href }: { id: string; href: string }) {
  const [, start] = useTransition();
  return (
    <Button asChild className="h-11 bg-whatsapp text-white hover:bg-whatsapp-hover">
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        data-testid={`btn-enviar-retorno-${id}`}
        onClick={() =>
          start(async () => {
            const r = await markReturnContacted(id, true);
            if (!r) return; // demonstração: o servidor redirecionou
            if (!r.ok) toast.error(r.error);
          })
        }
      >
        <MessageCircle className="mr-1.5 h-4 w-4" /> Chamar para voltar
      </a>
    </Button>
  );
}

export function UndoReturnButton({ id }: { id: string }) {
  const [pending, start] = useTransition();
  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-10 text-muted-foreground"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await markReturnContacted(id, false);
          if (!r) return; // demonstração: o servidor redirecionou
          if (r.ok) toast.success("Voltou para a fila");
          else toast.error(r.error);
        })
      }
      data-testid={`btn-desfazer-retorno-${id}`}
    >
      <RotateCcw className="mr-1.5 h-4 w-4" /> Voltar para a fila
    </Button>
  );
}
