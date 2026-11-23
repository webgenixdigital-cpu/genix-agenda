"use client";

// 4b — Incluir, mudar ou tirar o leva e traz de um agendamento que já existe
import { useState, useTransition } from "react";
import { Car, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { getBookingTransport, setBookingTransport } from "@/app/admin/(painel)/leva-e-traz/actions";
import { TRANSPORT_LABEL } from "@/lib/pets";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

type Transport = "nenhum" | "busca" | "entrega" | "busca_entrega";
const OPTIONS: { value: Transport; label: string }[] = [
  { value: "nenhum", label: "Não" },
  { value: "busca", label: "Só busca" },
  { value: "entrega", label: "Só entrega" },
  { value: "busca_entrega", label: "Busca e entrega" },
];

export function BookingTransportButton({ bookingId, current, who }: { bookingId: string; current?: Transport; who: string }) {
  const [open, setOpen] = useState(false);
  const [loading, startLoad] = useTransition();
  const [pending, start] = useTransition();
  const [v, setV] = useState({ transport: "nenhum" as Transport, fee: "", address: "", addressRef: "" });

  function openDialog() {
    startLoad(async () => {
      const r = await getBookingTransport(bookingId);
      if (!r) return; // demonstração
      if (!r.ok) return void toast.error(r.error);
      setV({
        transport: r.info.transport,
        fee: r.info.fee > 0 ? r.info.fee.toFixed(2).replace(".", ",") : "",
        address: r.info.address ?? "",
        addressRef: r.info.addressRef ?? "",
      });
      setOpen(true);
    });
  }

  function save() {
    start(async () => {
      const r = await setBookingTransport(bookingId, v);
      if (!r) return;
      if (r.ok) {
        toast.success(v.transport === "nenhum" ? "Leva e traz retirado" : "Leva e traz salvo");
        setOpen(false);
      } else toast.error(r.error);
    });
  }

  const has = current && current !== "nenhum";

  return (
    <>
      <button
        type="button"
        className="flex min-h-11 w-full items-center justify-center gap-1.5 rounded-lg text-sm font-medium text-primary hover:bg-secondary disabled:opacity-50"
        disabled={loading}
        onClick={openDialog}
        data-testid={`btn-leva-traz-${bookingId}`}
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Car className="h-4 w-4" />}
        {has ? `Leva e traz: ${TRANSPORT_LABEL[current!]} · alterar` : "Incluir leva e traz"}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[92svh] w-[calc(100%-1.5rem)] max-w-lg overflow-y-auto rounded-2xl">
          <DialogHeader>
            <DialogTitle className="font-heading text-2xl">Leva e traz</DialogTitle>
            <DialogDescription>{who}. A taxa é cobrada à parte (não entra no total).</DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); save(); }}>
            <div className="flex flex-wrap gap-2">
              {OPTIONS.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  aria-pressed={v.transport === o.value}
                  onClick={() => setV({ ...v, transport: o.value })}
                  className={cn(
                    "min-h-11 rounded-full border px-4 text-sm font-medium",
                    v.transport === o.value ? "border-primary bg-primary text-primary-foreground" : "bg-white",
                  )}
                  data-testid={`btn-editar-leva-traz-${o.value}`}
                >
                  {o.label}
                </button>
              ))}
            </div>
            {v.transport !== "nenhum" && (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="lt-endereco">Endereço do tutor</Label>
                  <Input id="lt-endereco" className="h-11" maxLength={200} placeholder="Rua, número, bairro" value={v.address}
                    onChange={(e) => setV({ ...v, address: e.target.value })} data-testid="input-editar-endereco" />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="lt-ref">Referência (opcional)</Label>
                    <Input id="lt-ref" className="h-11" maxLength={120} placeholder="ex.: portão azul" value={v.addressRef}
                      onChange={(e) => setV({ ...v, addressRef: e.target.value })} data-testid="input-editar-referencia" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="lt-taxa">Taxa (R$)</Label>
                    <Input id="lt-taxa" className="h-11" inputMode="decimal" placeholder="0,00" value={v.fee}
                      onChange={(e) => setV({ ...v, fee: e.target.value.replace(/[^\d,.]/g, "").slice(0, 8) })} data-testid="input-editar-taxa" />
                  </div>
                </div>
              </>
            )}
            <Button type="submit" className="h-12 w-full text-base" disabled={pending} data-testid="btn-salvar-leva-traz">
              {pending ? <Loader2 className="h-5 w-5 animate-spin" /> : "Salvar"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
