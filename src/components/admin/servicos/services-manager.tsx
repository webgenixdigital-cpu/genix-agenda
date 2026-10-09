"use client";

import { useState, useTransition } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { deleteService, toggleService } from "@/app/admin/(painel)/servicos/actions";
import { ServiceDialog, type EditableService } from "@/components/admin/servicos/service-dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { brl, duration } from "@/lib/format";
import { cn } from "@/lib/utils";

type Row = EditableService & { active: boolean; bookable_online: boolean; show_in_catalog: boolean };

export function ServicesManager({ services }: { services: Row[] }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<EditableService | null>(null);
  const [pending, start] = useTransition();

  const categories = Array.from(new Set(services.map((s) => s.category).filter(Boolean))) as string[];
  const groups = services.reduce<Record<string, Row[]>>((acc, s) => {
    (acc[s.category ?? "Sem categoria"] ??= []).push(s);
    return acc;
  }, {});

  function toggle(id: string, field: "active" | "bookable_online" | "show_in_catalog", value: boolean) {
    start(async () => {
      const r = await toggleService(id, field, value);
      if (!r.ok) toast.error(r.error);
    });
  }

  function remove(s: Row) {
    if (!confirm(`Excluir "${s.name}"? Os agendamentos antigos continuam no histórico.`)) return;
    start(async () => {
      const r = await deleteService(s.id);
      if (r.ok) toast.success("Serviço excluído");
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
          data-testid="btn-novo-servico"
        >
          <Plus className="mr-1.5 h-4 w-4" /> Novo serviço
        </Button>
      </div>

      {services.length === 0 && (
        <div className="rounded-2xl border border-dashed bg-white p-10 text-center">
          <p className="font-heading text-2xl">Nenhum serviço ainda</p>
          <p className="mt-2 text-muted-foreground">Cadastre o primeiro para começar a receber agendamentos.</p>
        </div>
      )}

      {Object.entries(groups).map(([category, list]) => (
        <section key={category} className="space-y-3">
          <h2 className="font-sans text-sm font-semibold text-muted-foreground">{category}</h2>
          <ul className="divide-y rounded-2xl border bg-card">
            {list.map((s) => (
              <li key={s.id} className={cn("p-4 md:p-5", !s.active && "bg-stone-50")} data-testid={`servico-${s.id}`}>
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <p className={cn("font-semibold", !s.active && "text-muted-foreground line-through")}>{s.name}</p>
                    <p className="text-sm">
                      <strong>{brl(s.price)}</strong>
                      <span className="text-muted-foreground"> · {duration(s.duration_min)}</span>
                    </p>
                    {s.description && <p className="mt-1 text-sm text-muted-foreground">{s.description}</p>}
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-10 w-10"
                    aria-label={`Editar ${s.name}`}
                    onClick={() => {
                      setEditing(s);
                      setDialogOpen(true);
                    }}
                    data-testid={`btn-editar-servico-${s.id}`}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-10 w-10 text-muted-foreground hover:bg-red-50 hover:text-destructive"
                    aria-label={`Excluir ${s.name}`}
                    disabled={pending}
                    onClick={() => remove(s)}
                    data-testid={`btn-excluir-servico-${s.id}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>

                <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 border-t pt-3 text-sm">
                  <Toggle label="Ativo" checked={s.active} onChange={(v) => toggle(s.id, "active", v)} testId={`switch-ativo-${s.id}`} />
                  <Toggle
                    label="Agendamento online"
                    checked={s.bookable_online}
                    disabled={!s.active}
                    onChange={(v) => toggle(s.id, "bookable_online", v)}
                    testId={`switch-online-${s.id}`}
                  />
                  <Toggle
                    label="No catálogo"
                    checked={s.show_in_catalog}
                    disabled={!s.active}
                    onChange={(v) => toggle(s.id, "show_in_catalog", v)}
                    testId={`switch-catalogo-${s.id}`}
                  />
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <ServiceDialog open={dialogOpen} onOpenChange={setDialogOpen} service={editing} categories={categories} />
    </>
  );
}

function Toggle(props: { label: string; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void; testId: string }) {
  return (
    <label className={cn("flex min-h-8 cursor-pointer items-center gap-2", props.disabled && "cursor-not-allowed opacity-50")}>
      <Switch checked={props.checked} disabled={props.disabled} onCheckedChange={props.onChange} data-testid={props.testId} />
      {props.label}
    </label>
  );
}