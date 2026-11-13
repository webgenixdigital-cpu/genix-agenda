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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PhoneInput } from "@/components/phone-input-lazy";
import { BR, cleanCountry, displayPhone } from "@/lib/phone";
import { MONTHS, birthISO, birthParts, daysInMonth } from "@/lib/birthday";

type Customer = {
  id: string; name: string; phone: string; phone_country?: string | null;
  email: string | null; notes: string | null; birth_date: string | null;
};

// ---------------------------------------------------------------------
// PARTE 1 — Diálogo de cadastro / edição
// ---------------------------------------------------------------------
export function CustomerDialog({ customer }: { customer?: Customer }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [f, setF] = useState({ name: "", phone: "", phoneCountry: BR, email: "", notes: "" });
  // aniversário: só dia e mês (gravado como 2000-MM-DD)
  const [birth, setBirth] = useState<{ day: number | null; month: number | null }>({ day: null, month: null });
  const [error, setError] = useState<string | null>(null);
  const birthIncomplete = !!birth.day !== !!birth.month;

  function setBirthPart(change: { day?: number; month?: number }) {
    setBirth((b) => {
      const next = { ...b, ...change };
      // trocou para um mês mais curto (ex.: 31 → abril): o dia precisa ser escolhido de novo
      if (next.day && next.month && next.day > daysInMonth(next.month)) next.day = null;
      return next;
    });
  }

  function openDialog() {
    const phoneCountry = cleanCountry(customer?.phone_country);
    setF({
      name: customer?.name ?? "",
      phone: displayPhone(customer?.phone ?? "", phoneCountry),
      phoneCountry,
      email: customer?.email ?? "",
      notes: customer?.notes ?? "",
    });
    setBirth(birthParts(customer?.birth_date));
    setError(null);
    setOpen(true);
  }

  function submit() {
    setError(null);
    if (birthIncomplete) {
      setError("Aniversário: escolha o dia e o mês, ou limpe o campo.");
      return;
    }
    const input = { ...f, birthDate: birthISO(birth.day, birth.month) };
    start(async () => {
      const r = customer ? await updateCustomer(customer.id, input) : await createCustomer(input);
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
            <div className="space-y-1.5">
              <Label htmlFor="ct-phone">WhatsApp</Label>
              <PhoneInput
                id="ct-phone"
                value={f.phone}
                country={f.phoneCountry}
                onChange={(phone, phoneCountry) => setF({ ...f, phone, phoneCountry })}
                testId="input-cliente-whatsapp"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ct-email">E-mail (opcional)</Label>
              <Input id="ct-email" type="email" className="h-11" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} data-testid="input-cliente-email" />
            </div>
            <fieldset className="space-y-1.5">
              <legend className="text-sm font-medium">Aniversário (opcional)</legend>
              <div className="flex flex-wrap items-center gap-3">
                <Select
                  value={birth.day ? String(birth.day) : ""}
                  onValueChange={(v) => setBirthPart({ day: Number(v) })}
                >
                  <SelectTrigger className="h-11 w-24" aria-label="Dia do aniversário" data-testid="select-cliente-aniversario-dia">
                    <SelectValue placeholder="Dia" />
                  </SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: birth.month ? daysInMonth(birth.month) : 31 }, (_, i) => (
                      <SelectItem key={i + 1} value={String(i + 1)}>
                        {i + 1}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={birth.month ? String(birth.month) : ""}
                  onValueChange={(v) => setBirthPart({ month: Number(v) })}
                >
                  <SelectTrigger className="h-11 w-40" aria-label="Mês do aniversário" data-testid="select-cliente-aniversario-mes">
                    <SelectValue placeholder="Mês" />
                  </SelectTrigger>
                  <SelectContent>
                    {MONTHS.map((m, i) => (
                      <SelectItem key={m} value={String(i + 1)} className="capitalize">
                        {m}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {(birth.day || birth.month) && (
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-11 px-3"
                    onClick={() => setBirth({ day: null, month: null })}
                    data-testid="btn-cliente-aniversario-limpar"
                  >
                    Limpar
                  </Button>
                )}
              </div>
              {birthIncomplete && <p className="text-xs text-amber-800">Escolha o dia e o mês, ou limpe o campo.</p>}
            </fieldset>
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
