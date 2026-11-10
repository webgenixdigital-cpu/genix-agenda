"use client";

// Diálogo de confirmação da marca, no lugar do window.confirm().
// O confirm() nativo falha em navegadores embutidos (WhatsApp, Instagram) e depois que o
// usuário marca "impedir esta página de criar diálogos": devolve false na hora e o botão
// parece não responder. Este diálogo não depende do navegador.
import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel = "Voltar",
  destructive = false,
  pending = false,
  onConfirm,
  testId = "confirmar",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  pending?: boolean;
  onConfirm: () => void;
  /** prefixo dos data-testid: `<testId>-sim` e `<testId>-nao` */
  testId?: string;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !pending && onOpenChange(o)}>
      <DialogContent className="max-w-sm rounded-2xl" data-testid={`dialogo-${testId}`}>
        <DialogHeader>
          <DialogTitle className="font-heading text-2xl">{title}</DialogTitle>
          {description && <DialogDescription asChild><div className="space-y-2">{description}</div></DialogDescription>}
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" className="h-11" disabled={pending} onClick={() => onOpenChange(false)} data-testid={`${testId}-nao`}>
            {cancelLabel}
          </Button>
          <Button
            variant={destructive ? "destructive" : "default"}
            className="h-11"
            disabled={pending}
            onClick={onConfirm}
            data-testid={`${testId}-sim`}
          >
            {pending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
