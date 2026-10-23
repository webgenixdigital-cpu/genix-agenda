"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pencil, Plus, ShieldAlert, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { createCustomer, deleteCustomer, updateCustomer } from "@/app/admin/(painel)/clientes/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { maskPhone } from "@/lib/format";

type Customer = { id: string; name: string; phone: string; email: string | null; notes: string | null };

// ---------------------------------------------------------------------
// PARTE 1 — Diálogo de cadastro / edição
// ---------------------------------------------------------------------
export function CustomerDialog({ customer }: { customer?: Customer }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [f, setF] = useState({ name: "", phone: "", email: "", notes: "" });
  const [error, setError] = useState<string | null>(null);

  function openDialog() {
    setF({
      name: customer?.name ?? "",
      phone: maskPhone(customer?.phone ?? ""),
      email: customer?.email ?? "",
      notes: customer?.notes ?? "",
    });
    setError(null);
    setOpen(true);
  }

  function submit() {
    setError(null);
    start(async () => {
      const r = customer ? await updateCustomer(customer.id, f) : await createCustomer(f);
      if (!r) return; // demonstração
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setOpen(false);
      toast.success(customer ? "Cliente atualizado" : "Cliente cadastrado");
      if (!customer && r.id) router.push(`/admin/clientes/${r.id}`);
    });
  }

  return (
    <>
      {customer ? (
        <Button variant="outline" className="h-11" onClick={openDialog} data-testid="btn-editar-cliente">
          <Pencil className="mr-1.5 h-4 w-4" /> Editar
        </Button>
      ) : (
        <Button className="h-11" onClick={openDialog} data-testid="btn-novo-cliente">
          <Plus className="mr-1.5 h-4 w-4" /> Novo cliente
        </Button>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[92svh] w-[calc(100%-1.5rem)] max-w-md overflow-y-auto rounded-2xl">
          <DialogHeader>
            <DialogTitle className="font-heading text-2xl">{customer ? "Editar cliente" : "Novo cliente"}</DialogTitle>
            <DialogDescription>O WhatsApp identifica o cliente: agendamentos com o mesmo número entram na mesma ficha.</DialogDescription>
          </DialogHeader>

          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="ct-name">Nome</Label>
              <Input id="ct-name" className="h-11" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value.slice(0, 80) })} data-testid="input-cliente-nome" />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="ct-phone">WhatsApp</Label>
                <Input id="ct-phone" className="h-11" inputMode="tel" placeholder="(35) 99999-9999" value={f.phone}
                  onChange={(e) => setF({ ...f, phone: maskPhone(e.target.value) })} data-testid="input-cliente-whatsapp" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ct-email">E-mail (opcional)</Label>
                <Input id="ct-email" type="email" className="h-11" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ct-notes">Observações</Label>
              <Textarea id="ct-notes" rows={3} placeholder="Preferências, horários que prefere, como conheceu o espaço..."
                value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value.slice(0, 1000) })} data-testid="input-cliente-obs" />
              <p className="flex items-start gap-1.5 text-xs text-amber-800">
                <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                Não registre informações de saúde (alergias, doenças, medicamentos, gestação).
              </p>
            </div>

            {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-destructive">{error}</p>}

            <Button type="submit" className="h-12 w-full text-base" disabled={pending} data-testid="btn-salvar-cliente">
              {pending ? <Loader2 className="h-5 w-5 animate-spin" /> : "Salvar"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ---------------------------------------------------------------------
// PARTE 2 — Excluir (só matriz)
// ---------------------------------------------------------------------
export function DeleteCustomerButton({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="ghost"
      className="h-11 text-muted-foreground hover:bg-red-50 hover:text-destructive"
      disabled={pending}
      data-testid="btn-excluir-cliente"
      onClick={() => {
        if (!confirm(`Excluir a ficha de ${name}? Os agendamentos continuam no histórico do espaço.`)) return;
        start(async () => {
          const r = await deleteCustomer(id);
          if (!r) return; // demonstração
          if (r.ok) {
            toast.success("Cliente excluído");
            router.push("/admin/clientes");
          } else toast.error(r.error);
        });
      }}
    >
      {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="mr-1.5 h-4 w-4" />} Excluir
    </Button>
  );
}
