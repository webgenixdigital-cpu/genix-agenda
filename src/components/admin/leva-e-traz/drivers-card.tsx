"use client";

// 4b — Motoristas do leva e traz (só a matriz). O link do app do motorista entra na 4c.
import { useState, useTransition } from "react";
import { Loader2, Pencil, Plus, UserRound } from "lucide-react";
import { toast } from "sonner";
import { saveDriver } from "@/app/admin/(painel)/leva-e-traz/actions";
import type { DriverRow } from "@/components/admin/leva-e-traz/routes-board";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

export function DriversCard({ drivers }: { drivers: DriverRow[] }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<DriverRow | null>(null);
  const [v, setV] = useState({ name: "", phone: "", active: true });
  const [pending, start] = useTransition();

  function openDialog(d: DriverRow | null) {
    setEditing(d);
    setV({ name: d?.name ?? "", phone: d?.phone ?? "", active: d?.active ?? true });
    setOpen(true);
  }

  function save() {
    start(async () => {
      const r = await saveDriver(editing?.id ?? null, v);
      if (!r) return;
      if (r.ok) {
        toast.success(editing ? "Motorista atualizado" : "Motorista cadastrado");
        setOpen(false);
      } else toast.error(r.error);
    });
  }

  return (
    <section className="space-y-3" data-testid="card-motoristas">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-2xl">Motoristas</h2>
        <Button className="h-11" onClick={() => openDialog(null)} data-testid="btn-novo-motorista">
          <Plus className="mr-1.5 h-4 w-4" /> Novo motorista
        </Button>
      </div>
      {drivers.length === 0 ? (
        <p className="rounded-2xl border border-dashed bg-white p-6 text-center text-muted-foreground">Nenhum motorista cadastrado.</p>
      ) : (
        <ul className="divide-y rounded-2xl border bg-card">
          {drivers.map((d) => (
            <li key={d.id} className="flex items-center gap-3 p-4">
              <UserRound className="h-5 w-5 shrink-0 text-primary" />
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{d.name} {!d.active && <span className="text-xs font-normal text-muted-foreground">(inativo)</span>}</p>
                {d.phone && <p className="text-sm text-muted-foreground">{d.phone}</p>}
              </div>
              <Button variant="ghost" size="icon" className="h-11 w-11" onClick={() => openDialog(d)} aria-label={`Editar ${d.name}`}
                data-testid="btn-editar-motorista">
                <Pencil className="h-4 w-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[92svh] w-[calc(100%-1.5rem)] max-w-md overflow-y-auto rounded-2xl">
          <DialogHeader>
            <DialogTitle className="font-heading text-2xl">{editing ? "Editar motorista" : "Novo motorista"}</DialogTitle>
            <DialogDescription>O link do app do motorista fica disponível na próxima etapa.</DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); save(); }}>
            <div className="space-y-1.5">
              <Label htmlFor="mot-nome">Nome</Label>
              <Input id="mot-nome" className="h-11" maxLength={60} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })}
                data-testid="input-motorista-nome" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mot-whats">WhatsApp com DDD (opcional)</Label>
              <Input id="mot-whats" className="h-11" inputMode="tel" maxLength={20} value={v.phone}
                onChange={(e) => setV({ ...v, phone: e.target.value })} data-testid="input-motorista-whatsapp" />
            </div>
            <label className="flex min-h-11 items-center justify-between gap-3">
              <span className="text-sm font-medium">Ativo</span>
              <Switch checked={v.active} onCheckedChange={(on) => setV({ ...v, active: on })} data-testid="switch-motorista-ativo" />
            </label>
            <Button type="submit" className="h-12 w-full text-base" disabled={pending} data-testid="btn-salvar-motorista">
              {pending ? <Loader2 className="h-5 w-5 animate-spin" /> : "Salvar"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}
