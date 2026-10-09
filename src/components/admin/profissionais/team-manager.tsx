"use client";

import { useState, useTransition } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { deleteProfessional, toggleProfessional } from "@/app/admin/(painel)/profissionais/actions";
import { ProfessionalDialog, type EditablePro } from "@/components/admin/profissionais/professional-dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

type Row = EditablePro & { active: boolean };
type ServiceOption = { id: string; name: string; category: string | null };

export function TeamManager({ team, services }: { team: Row[]; services: ServiceOption[] }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<EditablePro | null>(null);
  const [pending, start] = useTransition();

  const serviceName = (id: string) => services.find((s) => s.id === id)?.name;

  function toggle(p: Row, active: boolean) {
    start(async () => {
      const r = await toggleProfessional(p.id, active);
      if (r.ok) toast.success(active ? `${p.name} está ativo` : `${p.name} foi desativado`);
      else toast.error(r.error);
    });
  }

  function remove(p: Row) {
    if (!confirm(`Excluir ${p.name}?`)) return;
    start(async () => {
      const r = await deleteProfessional(p.id);
      if (r.ok) toast.success("Profissional excluído");
      else toast.error(r.error);
    });
  }

  return (
    <>
      <div className="flex justify-end">
        <Button
          className="h-11"
          onClick={() => {
            setEditing(null);
            setDialogOpen(true);
          }}
          data-testid="btn-novo-profissional"
        >
          <Plus className="mr-1.5 h-4 w-4" /> Novo profissional
        </Button>
      </div>

      <ul className="grid gap-4 md:grid-cols-2">
        {team.map((p) => (
          <li key={p.id} className={cn("flex flex-col rounded-2xl border bg-card p-5", !p.active && "bg-stone-50")} data-testid={`profissional-${p.id}`}>
            <div className="flex items-start gap-4">
              <div className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-full bg-secondary font-heading text-xl text-primary">
                {p.photo_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.photo_url} alt={p.name} className="h-full w-full object-cover" />
                ) : (
                  p.name.charAt(0)
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className={cn("font-semibold", !p.active && "text-muted-foreground")}>{p.name}</p>
                {p.role && <p className="text-sm text-primary">{p.role}</p>}
                {p.commission_pct > 0 && (
                  <p className="text-xs text-muted-foreground">Comissão de {String(p.commission_pct).replace(".", ",")}%</p>
                )}
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-10 w-10"
                aria-label={`Editar ${p.name}`}
                onClick={() => {
                  setEditing(p);
                  setDialogOpen(true);
                }}
                data-testid={`btn-editar-profissional-${p.id}`}
              >
                <Pencil className="h-4 w-4" />
              </Button>
            </div>

            <p className="mt-3 text-sm text-muted-foreground">
              {p.serviceIds.length === 0
                ? "Faz todos os serviços"
                : `Faz: ${p.serviceIds.map(serviceName).filter(Boolean).join(", ")}`}
            </p>

<div className="mt-auto flex items-center justify-between border-t pt-3">
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <Switch checked={p.active} disabled={pending} onCheckedChange={(v) => toggle(p, v)} data-testid={`switch-profissional-${p.id}`} />
                {p.active ? "Ativo" : "Inativo"}
              </label>
              <Button
                variant="ghost"
                size="sm"
                className="h-10 text-muted-foreground hover:bg-red-50 hover:text-destructive"
                disabled={pending}
                onClick={() => remove(p)}
                data-testid={`btn-excluir-profissional-${p.id}`}
              >
                <Trash2 className="mr-1.5 h-4 w-4" /> Excluir
              </Button>
            </div>
          </li>
        ))}
      </ul>

      <ProfessionalDialog open={dialogOpen} onOpenChange={setDialogOpen} pro={editing} services={services} />
    </>
  );
}