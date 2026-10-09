"use client";

import { useTransition } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { deleteCashEntry } from "@/app/admin/(painel)/financeiro/actions";
import { Button } from "@/components/ui/button";

export function DeleteEntryButton({ id }: { id: string }) {
  const [pending, start] = useTransition();
  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-9 w-9 shrink-0 text-muted-foreground hover:bg-red-50 hover:text-destructive"
      disabled={pending}
      aria-label="Excluir lançamento"
      data-testid={`btn-excluir-lancamento-${id}`}
      onClick={() => {
        if (!confirm("Excluir este lançamento?")) return;
        start(async () => {
          const r = await deleteCashEntry(id);
          if (r.ok) toast.success("Lançamento excluído");
          else toast.error(r.error);
        });
      }}
    >
      {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
    </Button>
  );
}