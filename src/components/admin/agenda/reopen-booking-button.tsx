"use client";

// "Reabrir atendimento": desfaz uma conclusão feita por engano (46_reabrir_atendimento.sql).
// Usado no cartão da Agenda (BookingActions) e no Histórico da ficha do cliente.
import { Ajuda } from "@/components/ajuda";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { reopenBooking } from "@/app/admin/(painel)/agenda/actions";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/confirm-dialog";

export function ReopenBookingButton({
  bookingId,
  customerName,
  packageSession = false,
}: {
  bookingId: string;
  customerName: string;
  /** sessão de pacote: explica que a sessão continua reservada para este horário */
  packageSession?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        className="h-10"
        disabled={pending}
        onClick={() => setOpen(true)}
        data-testid={`btn-reabrir-${bookingId}`}
      >
        {pending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <RotateCcw className="mr-1.5 h-4 w-4" />}
        Reabrir atendimento
      </Button>
      <Ajuda id="reabrir-atendimento" />

      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Reabrir atendimento?"
        description={
          <>
            <p>O atendimento de {customerName} volta para “Confirmado”, como se ainda não tivesse sido concluído:</p>
            <ul className="list-disc space-y-1 pl-5 text-left">
              <li>o lançamento automático deste atendimento sai do caixa (lançamentos manuais não mudam);</li>
              <li>deixa de contar na comissão, em “Meus ganhos” e nas visitas do cliente;</li>
              {packageSession && <li>a sessão do pacote continua reservada para este horário (volta ao saldo só se cancelar);</li>}
              <li>uma avaliação já enviada continua; o link de avaliação fica pausado até concluir de novo.</li>
            </ul>
            <p>Depois é só concluir de novo, com o valor e a forma de pagamento certos. Fica registrado no histórico.</p>
          </>
        }
        confirmLabel="Reabrir"
        pending={pending}
        testId={`reabrir-${bookingId}`}
        onConfirm={() =>
          start(async () => {
            const r = await reopenBooking(bookingId);
            if (!r) return; // demonstração: o servidor redirecionou
            setOpen(false);
            if (!r.ok) return void toast.error(r.error);
            toast.success("Atendimento reaberto");
            router.refresh();
          })
        }
      />
    </>
  );
}
