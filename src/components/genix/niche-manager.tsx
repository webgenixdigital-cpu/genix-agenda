"use client";

import { useState, useTransition } from "react";
import { ChevronDown, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { deleteNiche, deleteTemplate, saveNiche, saveTemplate, toggleNiche } from "@/app/genix/actions";
import { NICHE_ICONS, NicheIcon } from "@/components/niche-icon";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { brl, duration } from "@/lib/format";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------
// PARTE 1 — Tipos
// ---------------------------------------------------------------------
export type AdminTemplate = {
  id: string;
  niche_id: string;
  name: string;
  category: string | null;
  description: string | null;
  duration_min: number;
  price: number;
  sort_order: number;
};

export type AdminNiche = {
  id: string;
  segment: string;
  name: string;
  description: string | null;
  icon: string;
  sort_order: number;
  active: boolean;
  featured: boolean;
  featured_order: number | null;
  usage: number;
  templates: AdminTemplate[];
};

const SEGMENT_LABEL: Record<string, string> = { beleza: "Beleza", estetica: "Estética", outros: "Outros profissionais" };

type R = { ok: boolean; error?: string };
function useRun() {
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<R>, ok: string, after?: () => void) =>
    start(async () => {
      const r = await fn();
      if (r.ok) {
        toast.success(ok);
        after?.();
      } else toast.error(r.error);
    });
  return { pending, run };
}

// ---------------------------------------------------------------------
// PARTE 2 — Lista principal
// ---------------------------------------------------------------------
export function NicheManager({ niches }: { niches: AdminNiche[] }) {
  const { pending, run } = useRun();
  const [nicheDialog, setNicheDialog] = useState<{ open: boolean; niche: AdminNiche | null }>({ open: false, niche: null });
  const [tplDialog, setTplDialog] = useState<{ open: boolean; nicheId: string; tpl: AdminTemplate | null }>({
    open: false,
    nicheId: "",
    tpl: null,
  });
  // cards minimizados por padrão
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="h-10" onClick={() => setExpanded(new Set(niches.map((n) => n.id)))}>
            Abrir todos
          </Button>
          <Button variant="outline" size="sm" className="h-10" onClick={() => setExpanded(new Set())}>
            Recolher todos
          </Button>
        </div>
        <Button className="h-11" onClick={() => setNicheDialog({ open: true, niche: null })} data-testid="btn-novo-nicho">
          <Plus className="mr-1.5 h-4 w-4" /> Novo nicho
        </Button>
      </div>

      {Object.keys(SEGMENT_LABEL).map((seg) => {
        const list = niches.filter((n) => n.segment === seg);
        if (list.length === 0) return null;
        return (
          <section key={seg} className="space-y-3">
            <h2 className="text-2xl">{SEGMENT_LABEL[seg]}</h2>
            <ul className="grid items-start gap-3 lg:grid-cols-2">
              {list.map((n) => (
                <li key={n.id} className={cn("rounded-2xl border bg-card", !n.active && "bg-stone-100")} data-testid={`nicho-${n.id}`}>
                  {/* Linha compacta (clique para abrir/fechar) */}
                  <button
                    type="button"
                    onClick={() => toggle(n.id)}
                    aria-expanded={expanded.has(n.id)}
                    className="flex w-full items-center gap-3 p-4 text-left"
                    data-testid={`toggle-nicho-${n.id}`}
                  >
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-secondary text-primary">
                      <NicheIcon name={n.icon} className="h-5 w-5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={cn("block font-semibold", !n.active && "text-muted-foreground")}>{n.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {n.templates.length} {n.templates.length === 1 ? "sugestão" : "sugestões"} · {n.usage}{" "}
                        {n.usage === 1 ? "espaço" : "espaços"} · {n.active ? "Ativo" : "Desativado"}
                        {n.featured && <> · Destaque{n.featured_order != null ? ` nº ${n.featured_order}` : ""}</>}
                      </span>
                    </span>
                    <ChevronDown className={cn("h-5 w-5 shrink-0 text-muted-foreground transition-transform", expanded.has(n.id) && "rotate-180")} />
                  </button>

                  {expanded.has(n.id) && (
                  <div className="border-t p-5">
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-mono text-xs text-muted-foreground">
                        {n.id} · ordem {n.sort_order} · {n.usage} {n.usage === 1 ? "espaço" : "espaços"}
                      </p>
                      {n.description && <p className="mt-1 text-sm text-muted-foreground">{n.description}</p>}
                    </div>
                    <Button variant="ghost" size="icon" className="h-10 w-10" aria-label={`Editar ${n.name}`}
                      onClick={() => setNicheDialog({ open: true, niche: n })}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                  </div>

                  {/* Serviços sugeridos */}
                  <div className="mt-4 rounded-xl bg-secondary/60 p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <p className="text-sm font-semibold">Serviços sugeridos ({n.templates.length})</p>
                      <Button size="sm" variant="ghost" className="h-8"
                        onClick={() => setTplDialog({ open: true, nicheId: n.id, tpl: null })}
                        data-testid={`btn-nova-sugestao-${n.id}`}>
                        <Plus className="mr-1 h-4 w-4" /> Adicionar
                      </Button>
                    </div>
                    {n.templates.length === 0 ? (
                      <p className="text-sm text-muted-foreground">Nenhuma sugestão.</p>
                    ) : (
                      <ul className="divide-y divide-stone-200">
                        {n.templates.map((t) => (
                          <li key={t.id} className="flex items-center gap-2 py-1.5 text-sm">
                            <span className="min-w-0 flex-1 truncate">{t.name}</span>
                            <span className="shrink-0 text-muted-foreground">{duration(t.duration_min)} · {brl(t.price)}</span>
                            <button className="grid h-8 w-8 place-items-center rounded-md hover:bg-white" aria-label={`Editar ${t.name}`}
                              onClick={() => setTplDialog({ open: true, nicheId: n.id, tpl: t })}>
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <button className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-red-50 hover:text-destructive"
                              aria-label={`Excluir ${t.name}`} disabled={pending}
                              onClick={() => confirm(`Excluir a sugestão "${t.name}"?`) && run(() => deleteTemplate(t.id), "Sugestão excluída")}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <div className="mt-3 flex items-center justify-between">
                    <label className="flex cursor-pointer items-center gap-2 text-sm">
                      <Switch checked={n.active} disabled={pending}
                        onCheckedChange={(v) => run(() => toggleNiche(n.id, v), v ? "Nicho ativado" : "Nicho desativado")}
                        data-testid={`switch-nicho-${n.id}`} />
                      {n.active ? "Ativo" : "Desativado"}
                    </label>
                    <Button size="sm" variant="ghost" className="h-9 text-muted-foreground hover:bg-red-50 hover:text-destructive"
                      disabled={pending}
                      onClick={() => confirm(`Excluir o nicho "${n.name}" e suas sugestões?`) && run(() => deleteNiche(n.id), "Nicho excluído")}>
                      <Trash2 className="mr-1.5 h-4 w-4" /> Excluir
                    </Button>
                  </div>
                  </div>
                  )}
                </li>
              ))}
            </ul>
          </section>
        );
      })}

      <NicheDialog state={nicheDialog} onClose={() => setNicheDialog({ open: false, niche: null })} />
      <TemplateDialog state={tplDialog} onClose={() => setTplDialog({ open: false, nicheId: "", tpl: null })} />
    </>
  );
}

// ---------------------------------------------------------------------
// PARTE 3 — Diálogo de nicho
// ---------------------------------------------------------------------
function NicheDialog({ state, onClose }: { state: { open: boolean; niche: AdminNiche | null }; onClose: () => void }) {
  const { pending, run } = useRun();
  const n = state.niche;
  const [f, setF] = useState({
    id: "", segment: "beleza", name: "", description: "", icon: "sparkles", sort_order: "0", featured: false, featured_order: "",
  });
  const [loaded, setLoaded] = useState<string | null | undefined>(undefined);

  if (state.open && loaded !== (n?.id ?? null)) {
    setLoaded(n?.id ?? null);
    setF({
      id: n?.id ?? "",
      segment: n?.segment ?? "beleza",
      name: n?.name ?? "",
      description: n?.description ?? "",
      icon: n?.icon ?? "sparkles",
      sort_order: String(n?.sort_order ?? 0),
      featured: n?.featured ?? false,
      featured_order: n?.featured_order != null ? String(n.featured_order) : "",
    });
  }
  if (!state.open && loaded !== undefined) setLoaded(undefined);

  return (
    <Dialog open={state.open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92svh] w-[calc(100%-1.5rem)] max-w-lg overflow-y-auto rounded-2xl">
        <DialogHeader>
          <DialogTitle className="font-heading text-2xl">{n ? "Editar nicho" : "Novo nicho"}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            run(
              () =>
                saveNiche({
                  originalId: n?.id,
                  ...f,
                  sort_order: Number(f.sort_order),
                  featured_order: f.featured_order ? Number(f.featured_order) : null,
                }),
              "Nicho salvo",
              onClose
            );
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="nc-name">Nome</Label>
              <Input id="nc-name" className="h-11" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value.slice(0, 60) })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nc-id">Identificador</Label>
              <Input id="nc-id" className="h-11 font-mono" disabled={!!n} placeholder="ex.: podologia" value={f.id}
                onChange={(e) => setF({ ...f, id: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 40) })} />
              {n && <p className="text-xs text-muted-foreground">Fixo depois de criado.</p>}
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-[1fr_100px]">
            <div className="space-y-1.5">
              <Label>Segmento</Label>
              <Select value={f.segment} onValueChange={(v) => setF({ ...f, segment: v })}>
                <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(SEGMENT_LABEL).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nc-order">Ordem</Label>
              <Input id="nc-order" className="h-11" inputMode="numeric" value={f.sort_order}
                onChange={(e) => setF({ ...f, sort_order: e.target.value.replace(/\D/g, "").slice(0, 3) })} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Ícone</Label>
            <div className="grid grid-cols-6 gap-2">
              {Object.keys(NICHE_ICONS).map((key) => (
                <button key={key} type="button" aria-label={key} aria-pressed={f.icon === key}
                  onClick={() => setF({ ...f, icon: key })}
                  className={cn("grid h-11 place-items-center rounded-lg border", f.icon === key ? "border-primary bg-primary/10 text-primary" : "hover:border-primary/50")}>
                  <NicheIcon name={key} className="h-5 w-5" />
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="nc-desc">Descrição curta</Label>
            <Textarea id="nc-desc" rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value.slice(0, 160) })} />
          </div>
          {/* Destaque nos círculos da página principal */}
          <div className="grid gap-3 rounded-xl bg-secondary/60 p-3 sm:grid-cols-[1fr_120px] sm:items-end">
            <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm font-medium">
              <Switch checked={f.featured} onCheckedChange={(v) => setF({ ...f, featured: v })} data-testid="switch-nicho-destaque" />
              Destaque na página principal
            </label>
            <div className="space-y-1.5">
              <Label htmlFor="nc-featured-order">Ordem no destaque</Label>
              <Input id="nc-featured-order" className="h-11" inputMode="numeric" placeholder="1 a 99" disabled={!f.featured}
                value={f.featured_order}
                onChange={(e) => setF({ ...f, featured_order: e.target.value.replace(/\D/g, "").slice(0, 2) })}
                data-testid="input-nicho-ordem-destaque" />
            </div>
          </div>
          <p className="-mt-2 text-xs text-muted-foreground">
            A página principal mostra só os nichos ativos com destaque, nessa ordem. Sem nenhum marcado, mostra os 8 primeiros pela ordem geral.
          </p>
          <Button type="submit" className="h-12 w-full text-base" disabled={pending}>
            {pending ? <Loader2 className="h-5 w-5 animate-spin" /> : "Salvar nicho"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------
// PARTE 4 — Diálogo de serviço sugerido
// ---------------------------------------------------------------------
function TemplateDialog({
  state,
  onClose,
}: {
  state: { open: boolean; nicheId: string; tpl: AdminTemplate | null };
  onClose: () => void;
}) {
  const { pending, run } = useRun();
  const t = state.tpl;
  const [f, setF] = useState({ name: "", category: "", description: "", duration_min: "60", price: "0", sort_order: "0" });
  const [loaded, setLoaded] = useState<string | null | undefined>(undefined);

  if (state.open && loaded !== (t?.id ?? null)) {
    setLoaded(t?.id ?? null);
    setF({
      name: t?.name ?? "",
      category: t?.category ?? "",
      description: t?.description ?? "",
      duration_min: String(t?.duration_min ?? 60),
      price: String(t?.price ?? 0).replace(".", ","),
      sort_order: String(t?.sort_order ?? 0),
    });
  }
  if (!state.open && loaded !== undefined) setLoaded(undefined);

  return (
    <Dialog open={state.open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-[calc(100%-1.5rem)] max-w-md rounded-2xl">
        <DialogHeader>
          <DialogTitle className="font-heading text-2xl">{t ? "Editar sugestão" : "Nova sugestão"}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            run(
              () =>
                saveTemplate({
                  id: t?.id,
                  niche_id: state.nicheId,
                  name: f.name,
                  category: f.category,
                  description: f.description,
                  duration_min: Number(f.duration_min),
                  price: Number(f.price.replace(/\./g, "").replace(",", ".")),
                  sort_order: Number(f.sort_order),
                }),
              "Sugestão salva",
              onClose
            );
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="tp-name">Serviço</Label>
            <Input id="tp-name" className="h-11" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value.slice(0, 80) })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tp-cat">Categoria</Label>
            <Input id="tp-cat" className="h-11" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value.slice(0, 40) })} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="tp-dur">Minutos</Label>
              <Input id="tp-dur" className="h-11" inputMode="numeric" value={f.duration_min}
                onChange={(e) => setF({ ...f, duration_min: e.target.value.replace(/\D/g, "").slice(0, 3) })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tp-price">Preço (R$)</Label>
              <Input id="tp-price" className="h-11" inputMode="decimal" value={f.price}
                onChange={(e) => setF({ ...f, price: e.target.value.replace(/[^\d,]/g, "").slice(0, 9) })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tp-order">Ordem</Label>
              <Input id="tp-order" className="h-11" inputMode="numeric" value={f.sort_order}
                onChange={(e) => setF({ ...f, sort_order: e.target.value.replace(/\D/g, "").slice(0, 3) })} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tp-desc">Descrição</Label>
            <Textarea id="tp-desc" rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value.slice(0, 200) })} />
          </div>
          <Button type="submit" className="h-12 w-full text-base" disabled={pending}>
            {pending ? <Loader2 className="h-5 w-5 animate-spin" /> : "Salvar sugestão"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
