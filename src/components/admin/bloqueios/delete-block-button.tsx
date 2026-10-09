"use client";

import { useTransition } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { deleteBlock } from "@/app/admin/(painel)/bloqueios/actions";
import { Button } from "@/components/ui/button";

export function DeleteBlockButton({ id }: { id: string }) {
  const [pending, start] = useTransition();

  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-10 w-10 shrink-0 text-muted-foreground hover:bg-red-50 hover:text-destructive"
      disabled={pending}
      aria-label="Remover bloqueio"
      data-testid={`btn-remover-bloqueio-${id}`}
      onClick={() => {
        if (!confirm("Remover este bloqueio? Os horários voltam a aparecer na vitrine.")) return;
        start(async () => {
          const r = await deleteBlock(id);
          if (r.ok) toast.success("Bloqueio removido");
          else toast.error(r.error);
        });
      }}
    >
      {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
    </Button>
  );
}