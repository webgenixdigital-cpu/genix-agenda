"use client";

import { useState, useTransition } from "react";
import { ChevronDown, Loader2, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { saveProfileField, toggleProfileField } from "@/app/genix/field-actions";
import { NicheIcon } from "@/components/niche-icon";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export type AdminField = {
  id: string;
  niche_id: string;
  key: string;
  label: string;
  type: "text" | "textarea" | "select";
  options: string[];
  help: string | null;
  sort_order: number;
  active: boolean;
};

const TYPE_LABEL = { text: "Texto curto", textarea: "Texto longo", select: "Lista de opções" };

export function ProfileFieldsManager({
  niches,
  fields,
}: {
  niches: { id: string; name: string; icon: string }[];
  fields: AdminField[];
}) {
  const [pending, start] = useTransition();
  const [dialog, setDialog] = useState<{ open: boolean; nicheId: string; field: AdminField | null }>({ open: false, nicheId: "", field: null });
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-3xl">Fichas técnicas</h2>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Campos que aparecem na ficha de cada cliente, conforme o tipo de espaço. Não crie campos de saúde
          (alergias, doenças, medicamentos): o Genix Agenda não trata dados de saúde.
        </p>
      </div>

      <div className="flex gap-2">
        <Button variant="outline" size="sm" className="h-10" onClick={() => setExpanded(new Set(niches.map((n) => n.id)))}>
          Abrir todos
        </Button>
        <Button variant="outline" size="sm" className="h-10" onClick={() => setExpanded(new Set())}>
          Recolher todos
        </Button>
      </div>

      <ul className="grid items-start gap-3 lg:grid-cols-2">
        {niches.map((n) => {
          const list = fields.filter((f) => f.niche_id === n.id);
          return (
            <li key={n.id} className="rounded-2xl border bg-card" data-testid={`ficha-nicho-${n.id}`}>
              <button
                type="button"
                onClick={() => toggle(n.id)}
                aria-expanded={expanded.has(n.id)}
                className="flex w-full items-center gap-3 p-4 text-left"
                data-testid={`toggle-ficha-${n.id}`}
              >
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-secondary text-primary">
                  <NicheIcon name={n.icon} className="h-5 w-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{n.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {list.filter((f) => f.active).length} {list.filter((f) => f.active).length === 1 ? "campo ativo" : "campos ativos"}
                    {list.some((f) => !f.active) && ` · ${list.filter((f) => !f.active).length} desativado(s)`}
                  </span>
                </span>
                <ChevronDown className={cn("h-5 w-5 shrink-0 text-muted-foreground transition-transform", expanded.has(n.id) && "rotate-180")} />
              </button>

              {expanded.has(n.id) && (
              <div className="border-t p-5">
              <div className="mb-3 flex justify-end">
                <Button size="sm" variant="ghost" className="h-8" onClick={() => setDialog({ open: true, nicheId: n.id, field: null })}>
                  <Plus className="mr-1 h-4 w-4" /> Campo
                </Button>
              </div>
              {list.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhum campo.</p>
              ) : (
                <ul className="divide-y">
                  {list.map((f) => (
                    <li key={f.id} className={cn("flex items-center gap-2 py-2 text-sm", !f.active && "opacity-50")}>
                      <span className="min-w-0 flex-1">
                        <span className="font-medium">{f.label}</span>
                        <span className="text-muted-foreground"> · {TYPE_LABEL[f.type]}</span>
                      </span>
                      <Switch
                        checked={f.active}
                        disabled={pending}
                        aria-label={f.active ? "Desativar campo" : "Ativar campo"}
                        onCheckedChange={(v) =>
                          start(async () => {
                            const r = await toggleProfileField(f.id, v);
                            if (!r.ok) toast.error(r.error);
                          })
                        }
                      />
                      <button className="grid h-8 w-8 place-items-center rounded-md hover:bg-secondary" aria-label={`Editar ${f.label}`}
                        onClick={() => setDialog({ open: true, nicheId: n.id, field: f })}>
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              </div>
              )}
            </li>
          );
        })}
      </ul>

      <FieldDialog state={dialog} onClose={() => setDialog({ open: false, nicheId: "", field: null })} />
    </section>
  );
}

function FieldDialog({
  state,
  onClose,
}: {
  state: { open: boolean; nicheId: string; field: AdminField | null };
  onClose: () => void;
}) {
  const [pending, start] = useTransition();
  const fl = state.field;
  const [f, setF] = useState({ label: "", type: "text" as AdminField["type"], options: "", help: "", sort_order: "0" });
  const [loaded, setLoaded] = useState<string | null | undefined>(undefined);

  if (state.open && loaded !== (fl?.id ?? null)) {
    setLoaded(fl?.id ?? null);
    setF({
      label: fl?.label ?? "",
      type: fl?.type ?? "text",
      options: (fl?.options ?? []).join("\n"),
      help: fl?.help ?? "",
      sort_order: String(fl?.sort_order ?? 0),
    });
  }
  if (!state.open && loaded !== undefined) setLoaded(undefined);

  return (
    <Dialog open={state.open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92svh] w-[calc(100%-1.5rem)] max-w-md overflow-y-auto rounded-2xl">
        <DialogHeader>
          <DialogTitle className="font-heading text-2xl">{fl ? "Editar campo" : "Novo campo"}</DialogTitle>
          <DialogDescription>Não use campos de saúde.</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const r = await saveProfileField({ id: fl?.id, niche_id: state.nicheId, ...f, sort_order: Number(f.sort_order) });
              if (r.ok) {
                toast.success("Campo salvo");
                onClose();
              } else toast.error(r.error);
            });
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="fd-label">Nome do campo</Label>
            <Input id="fd-label" className="h-11" value={f.label} onChange={(e) => setF({ ...f, label: e.target.value.slice(0, 60) })} />
          </div>
          <div className="grid grid-cols-[1fr_90px] gap-3">
            <div className="space-y-1.5">
              <Label>Tipo</Label>
              <Select value={f.type} onValueChange={(v) => setF({ ...f, type: v as AdminField["type"] })}>
                <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(TYPE_LABEL).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fd-order">Ordem</Label>
              <Input id="fd-order" className="h-11" inputMode="numeric" value={f.sort_order}
                onChange={(e) => setF({ ...f, sort_order: e.target.value.replace(/\D/g, "").slice(0, 3) })} />
            </div>
          </div>
          {f.type === "select" && (
            <div className="space-y-1.5">
              <Label htmlFor="fd-options">Opções (uma por linha)</Label>
              <Textarea id="fd-options" rows={4} value={f.options} onChange={(e) => setF({ ...f, options: e.target.value })} />
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="fd-help">Dica de preenchimento (opcional)</Label>
            <Input id="fd-help" className="h-11" value={f.help} onChange={(e) => setF({ ...f, help: e.target.value.slice(0, 120) })} />
          </div>
          <Button type="submit" className="h-12 w-full text-base" disabled={pending}>
            {pending ? <Loader2 className="h-5 w-5 animate-spin" /> : "Salvar campo"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
