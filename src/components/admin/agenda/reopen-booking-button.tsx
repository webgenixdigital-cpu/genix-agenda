"use client";

// "Reabrir atendimento": desfaz uma conclusão feita por engano (46_reabrir_atendimento.sql).
// ReopenBookingButton (botão + diálogo): Histórico da ficha do cliente.
// ReopenDialog (só o diálogo): Agenda, aberto pelo BookingDialogsProvider (fora do cartão).
import { Ajuda } from "@/components/ajuda";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { reopenBooking } from "@/app/admin/(painel)/agenda/actions";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/confirm-dialog";

type ReopenProps = {
  bookingId: string;
  customerName: string;
  /** sessão de pacote: explica que a sessão continua reservada para este horário */
  packageSession?: boolean;
};

export function ReopenDialog({
  open,
  onOpenChange,
  bookingId,
  customerName,
  packageSession = false,
}: ReopenProps & { open: boolean; onOpenChange: (o: boolean) => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
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
          onOpenChange(false);
          if (!r.ok) return void toast.error(r.error);
          toast.success("Atendimento reaberto");
          router.refresh();
        })
      }
    />
  );
}

/** Botão "Reabrir atendimento" (+ ajuda). Sem onOpen, abre o próprio diálogo (ficha do cliente). */
export function ReopenBookingButton({
  onOpen,
  ...props
}: ReopenProps & {
  /** Agenda: quem abre é o BookingDialogsProvider */
  onOpen?: () => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        className="h-10"
        onClick={() => (onOpen ? onOpen() : setOpen(true))}
        data-testid={`btn-reabrir-${props.bookingId}`}
      >
        <RotateCcw className="mr-1.5 h-4 w-4" />
        Reabrir atendimento
      </Button>
      <Ajuda id="reabrir-atendimento" />
      {!onOpen && <ReopenDialog open={open} onOpenChange={setOpen} {...props} />}
    </>
  );
}
