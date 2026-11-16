"use client";

// Botão "Registrar pagamento" + diálogo, para telas fora da Agenda (ficha do cliente).
// Dentro de lista desenhada no servidor, use SEMPRE com key={id}: sem ela o estado
// do diálogo fica preso à posição do item (armadilha do CLAUDE.md, PR 43).
import { useState } from "react";
import { Wallet } from "lucide-react";
import { RegisterPaymentDialog, type PaymentTarget } from "@/components/admin/register-payment-dialog";
import { Button } from "@/components/ui/button";

export function RegisterPaymentButton({ target, today }: { target: PaymentTarget; today: string }) {
  const [open, setOpen] = useState(false);
  // cópia do alvo tirada ao abrir: não muda se a tela for redesenhada com o diálogo aberto
  const [snapshot, setSnapshot] = useState<PaymentTarget | null>(null);
  return (
    <>
      <Button
        size="sm"
        className="h-10"
        onClick={() => {
          setSnapshot({ ...target });
          setOpen(true);
        }}
        data-testid={`btn-registrar-pagamento-${target.id}`}
      >
        <Wallet className="mr-1.5 h-4 w-4" /> Registrar pagamento
      </Button>
      <RegisterPaymentDialog open={open} onOpenChange={setOpen} target={snapshot} today={today} />
    </>
  );
}
