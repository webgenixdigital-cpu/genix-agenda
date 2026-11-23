"use client";

// 4a — Endereço do tutor para o leva e traz (só banho e tosa)
import { useState, useTransition } from "react";
import { Loader2, MapPin, Pencil } from "lucide-react";
import { toast } from "sonner";
import { updateTutorAddress } from "@/app/admin/(painel)/clientes/pet-actions";
import { ReadOnlyLink, usePlanFlags } from "@/components/admin/plan-flags";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Address = { address: string | null; address_ref: string | null; alt_contact: string | null };

export function TutorAddressCard({ customerId, initial }: { customerId: string; initial: Address }) {
  const { readOnly } = usePlanFlags();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [v, setV] = useState({ address: "", addressRef: "", altContact: "" });

  function openDialog() {
    setV({ address: initial.address ?? "", addressRef: initial.address_ref ?? "", altContact: initial.alt_contact ?? "" });
    setOpen(true);
  }

  function save() {
    start(async () => {
      const r = await updateTutorAddress(customerId, v);
      if (!r) return; // demonstração
      if (r.ok) {
        toast.success("Endereço salvo");
        setOpen(false);
      } else toast.error(r.error);
    });
  }

  const maps = initial.address
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(initial.address)}`
    : null;

  return (
    <section className="rounded-2xl border bg-card p-5" data-testid="card-endereco-tutor">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h2 className="flex items-center gap-2 text-2xl">
          <MapPin className="h-5 w-5 text-primary" /> Endereço (leva e traz)
        </h2>
        {readOnly ? (
          <ReadOnlyLink label="Editar" testid="btn-editar-endereco-travado" />
        ) : (
          <Button variant="outline" className="h-10" onClick={openDialog} data-testid="btn-editar-endereco">
            <Pencil className="mr-1.5 h-4 w-4" /> {initial.address ? "Editar" : "Adicionar"}
          </Button>
        )}
      </div>
      {initial.address ? (
        <div className="mt-3 space-y-1 text-sm">
          <p>{initial.address}</p>
          {initial.address_ref && <p className="text-muted-foreground">Referência: {initial.address_ref}</p>}
          {initial.alt_contact && <p className="text-muted-foreground">Também entrega/busca: {initial.alt_contact}</p>}
          {maps && (
            <a href={maps} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center font-medium text-primary underline"
              data-testid="link-endereco-mapa">
              Abrir no mapa
            </a>
          )}
        </div>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">Sem endereço. Ele é pedido ao marcar o leva e traz.</p>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[92svh] w-[calc(100%-1.5rem)] max-w-lg overflow-y-auto rounded-2xl">
          <DialogHeader>
            <DialogTitle className="font-heading text-2xl">Endereço do tutor</DialogTitle>
            <DialogDescription>Usado pelo motorista no leva e traz.</DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); save(); }}>
            <div className="space-y-1.5">
              <Label htmlFor="end-endereco">Endereço</Label>
              <Input id="end-endereco" className="h-11" maxLength={200} placeholder="Rua, número, bairro" value={v.address}
                onChange={(e) => setV({ ...v, address: e.target.value })} data-testid="input-endereco" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="end-referencia">Referência (opcional)</Label>
              <Input id="end-referencia" className="h-11" maxLength={120} placeholder="ex.: portão azul" value={v.addressRef}
                onChange={(e) => setV({ ...v, addressRef: e.target.value })} data-testid="input-referencia" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="end-contato">Outra pessoa que entrega ou busca (opcional)</Label>
              <Input id="end-contato" className="h-11" maxLength={120} placeholder="ex.: Maria (vizinha)" value={v.altContact}
                onChange={(e) => setV({ ...v, altContact: e.target.value })} data-testid="input-contato-alternativo" />
            </div>
            <Button type="submit" className="h-12 w-full text-base" disabled={pending} data-testid="btn-salvar-endereco">
              {pending ? <Loader2 className="h-5 w-5 animate-spin" /> : "Salvar endereço"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}
