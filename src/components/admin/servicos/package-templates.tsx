"use client";

import { Ajuda } from "@/components/ajuda";
import { useState, useTransition } from "react";
import { Loader2, Package, Pencil, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import {
  deletePackageTemplate,
  savePackageTemplate,
  togglePackageTemplate,
} from "@/app/admin/(painel)/servicos/package-actions";
import { maskMoney, parseMoney } from "@/components/admin/servicos/service-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { brl } from "@/lib/format";
import { cn } from "@/lib/utils";

export type PackageTemplateItem = { service_id: string; sessions: number };

export type PackageTemplate = {
  id: string;
  name: string;
  price: number;
  validity_days: number | null;
  active: boolean;
  /** 37_plano_fechado: serviços do pacote, na ordem */
  items: PackageTemplateItem[];
};

type ServiceOption = { id: string; name: string; price: number };

const VALIDITY_PRESETS = [30, 60, 90, 180];
const MAX_SERVICES = 6;
const MAX_SESSIONS = 100;

/** "4× Manicure + 2× Pedicure" */
export function packageItemsText(items: PackageTemplateItem[], serviceName: (id: string) => string) {
  return items.map((i) => `${i.sessions}× ${serviceName(i.service_id)}`).join(" + ");
}

export function PackageTemplates({ templates, services }: { templates: PackageTemplate[]; services: ServiceOption[] }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<PackageTemplate | null>(null);
  const [pending, start] = useTransition();
  const serviceName = (id: string) => services.find((s) => s.id === id)?.name ?? "Serviço inativo";

  function toggle(id: string, active: boolean) {
    start(async () => {
      const r = await togglePackageTemplate(id, active);
      if (!r) return; // demonstração: o servidor redirecionou
      if (!r.ok) toast.error(r.error);
    });
  }

  function remove(t: PackageTemplate) {
    if (!confirm(`Excluir o modelo “${t.name}”? Pacotes já vendidos continuam valendo.`)) return;
    start(async () => {
      const r = await deletePackageTemplate(t.id);
      if (!r) return; // demonstração: o servidor redirecionou
      if (r.ok) toast.success("Modelo excluído");
      else toast.error(r.error);
    });
  }

  return (
    <section className="space-y-3" data-testid="secao-pacotes">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl">Pacotes <Ajuda id="pacotes-modelos" className="-ml-2" /></h2>
          <p className="text-sm text-muted-foreground">
            Modelos para vender na ficha do cliente: um serviço (10 drenagens) ou vários (4 manicures + 2 pedicures).
          </p>
        </div>
        <Button
          variant="outline"
          className="h-11"
          disabled={services.length === 0}
          onClick={() => {
            setEditing(null);
            setOpen(true);
          }}
          data-testid="btn-novo-pacote"
        >
          <Plus className="mr-1.5 h-4 w-4" /> Novo pacote
        </Button>
      </div>

      {templates.length === 0 ? (
        <div className="rounded-2xl border border-dashed bg-white p-8 text-center text-sm text-muted-foreground">
          Nenhum modelo de pacote ainda.
        </div>
      ) : (
        <ul className="divide-y rounded-2xl border bg-card">
          {templates.map((t) => (
            <li key={t.id} className={cn("flex items-center gap-3 p-4", !t.active && "bg-stone-50")} data-testid={`pacote-modelo-${t.id}`}>
              <Package className="h-5 w-5 shrink-0 text-primary" />
              <div className="min-w-0 flex-1">
                <p className={cn("font-semibold", !t.active && "text-muted-foreground")}>{t.name}</p>
                <p className="text-sm text-muted-foreground">
                  {packageItemsText(t.items, serviceName)} · <strong className="text-foreground">{brl(t.price)}</strong>
                  {" · "}
                  {t.validity_days ? `validade ${t.validity_days} dias` : "sem validade"}
                </p>
              </div>
              <Switch
                checked={t.active}
                disabled={pending}
                onCheckedChange={(v) => toggle(t.id, v)}
                aria-label={t.active ? "Desativar modelo" : "Ativar modelo"}
                data-testid={`switch-pacote-ativo-${t.id}`}
              />
              <Button
                variant="ghost"
                size="icon"
                className="h-11 w-11"
                aria-label={`Editar ${t.name}`}
                onClick={() => {
                  setEditing(t);
                  setOpen(true);
                }}
                data-testid={`btn-editar-pacote-${t.id}`}
              >
                <Pencil className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-11 w-11 text-muted-foreground hover:bg-red-50 hover:text-destructive"
                aria-label={`Excluir ${t.name}`}
                disabled={pending}
                onClick={() => remove(t)}
                data-testid={`btn-excluir-pacote-${t.id}`}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <PackageTemplateDialog open={open} onOpenChange={setOpen} template={editing} services={services} />
    </section>
  );
}

type Row = { service_id: string; sessions: string };

function PackageTemplateDialog({
  open,
  onOpenChange,
  template,
  services,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  template: PackageTemplate | null; // null = novo
  services: ServiceOption[];
}) {
  const [pending, start] = useTransition();
  const [rows, setRows] = useState<Row[]>([{ service_id: "", sessions: "10" }]);
  const [name, setName] = useState("");
  const [price, setPrice] = useState("0,00");
  const [priceTouched, setPriceTouched] = useState(false);
  const [validity, setValidity] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loadedId, setLoadedId] = useState<string | null | undefined>(undefined);

  // preenche o formulário ao abrir
  if (open && loadedId !== (template?.id ?? null)) {
    setLoadedId(template?.id ?? null);
    setRows(
      template?.items.length
        ? template.items.map((i) => ({ service_id: i.service_id, sessions: String(i.sessions) }))
        : [{ service_id: "", sessions: "10" }]
    );
    setName(template?.name ?? "");
    setPrice(maskMoney(String(Math.round((template?.price ?? 0) * 100))));
    setPriceTouched(!!template);
    setValidity(template?.validity_days ? String(template.validity_days) : "");
    setError(null);
  }
  if (!open && loadedId !== undefined) setLoadedId(undefined);

  const byId = (id: string) => services.find((s) => s.id === id);
  const chosen = rows.filter((r) => r.service_id);
  const totalSessions = chosen.reduce((s, r) => s + (Number(r.sessions) || 0), 0);
  // valor avulso: soma de preço × sessões de cada serviço
  const fullPrice = chosen.reduce((s, r) => s + (byId(r.service_id)?.price ?? 0) * (Number(r.sessions) || 0), 0);
  const savings = fullPrice - parseMoney(price);

  /** sugere nome e preço cheio enquanto a matriz não mexeu neles */
  function update(next: Row[]) {
    setRows(next);
    const picked = next.filter((r) => r.service_id && byId(r.service_id));
    if (!picked.length) return;
    if (!priceTouched) {
      const cents = Math.round(picked.reduce((s, r) => s + byId(r.service_id)!.price * (Number(r.sessions) || 0), 0) * 100);
      setPrice(maskMoney(String(cents)));
    }
    if (!template && (!name.trim() || name === suggestedName(rows))) setName(suggestedName(next));
  }

  function suggestedName(list: Row[]) {
    const picked = list.filter((r) => r.service_id && byId(r.service_id));
    if (picked.length === 1) return `${picked[0].sessions}× ${byId(picked[0].service_id)!.name}`.slice(0, 80);
    return picked.map((r) => byId(r.service_id)!.name).join(" + ").slice(0, 80);
  }

  function setRow(i: number, patch: Partial<Row>) {
    update(rows.map((r, n) => (n === i ? { ...r, ...patch } : r)));
  }

  function submit() {
    setError(null);
    if (!chosen.length) return setError("Escolha pelo menos um serviço.");
    start(async () => {
      const r = await savePackageTemplate({
        id: template?.id,
        name,
        price: parseMoney(price),
        validity_days: validity ? Number(validity) : null,
        items: chosen.map((x) => ({ service_id: x.service_id, sessions: Number(x.sessions) || 0 })),
      });
      if (!r) return; // demonstração: o servidor redirecionou
      if (r.ok) {
        toast.success(template ? "Pacote atualizado" : "Pacote criado");
        onOpenChange(false);
      } else setError(r.error);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92svh] w-[calc(100%-1.5rem)] max-w-lg overflow-y-auto rounded-2xl">
        <DialogHeader>
          <DialogTitle className="font-heading text-2xl">{template ? "Editar pacote" : "Novo pacote"}</DialogTitle>
          <DialogDescription>Mudanças valem para as próximas vendas; pacotes já vendidos não mudam.</DialogDescription>
        </DialogHeader>

        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="space-y-2">
            <Label>Serviços e sessões</Label>
            <ul className="space-y-2" data-testid="lista-servicos-pacote">
              {rows.map((r, i) => (
                <li key={i} className="flex items-center gap-2">
                  <Select value={r.service_id} onValueChange={(v) => setRow(i, { service_id: v })}>
                    <SelectTrigger className="h-11 min-w-0 flex-1" data-testid={`select-pacote-servico-${i}`}>
                      <SelectValue placeholder="Escolha o serviço" />
                    </SelectTrigger>
                    <SelectContent className="max-h-64">
                      {services
                        .filter((s) => s.id === r.service_id || !rows.some((x) => x.service_id === s.id))
                        .map((s) => (
                          <SelectItem key={s.id} value={s.id}>{s.name} · {brl(s.price)}</SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                  <div className="relative w-24 shrink-0">
                    <Input
                      className="h-11 pr-7"
                      inputMode="numeric"
                      aria-label="Sessões"
                      value={r.sessions}
                      onChange={(e) => setRow(i, { sessions: e.target.value.replace(/\D/g, "").slice(0, 3) })}
                      data-testid={`input-pacote-sessoes-${i}`}
                    />
                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">×</span>
                  </div>
                  {rows.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-11 w-11 shrink-0 text-muted-foreground hover:text-destructive"
                      aria-label="Tirar este serviço"
                      onClick={() => update(rows.filter((_, n) => n !== i))}
                      data-testid={`btn-tirar-servico-pacote-${i}`}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
            {rows.length < MAX_SERVICES && rows.length < services.length && (
              <Button
                type="button"
                variant="outline"
                className="h-11"
                onClick={() => setRows([...rows, { service_id: "", sessions: "1" }])}
                data-testid="btn-adicionar-servico-pacote"
              >
                <Plus className="mr-1.5 h-4 w-4" /> Outro serviço
              </Button>
            )}
            <p className={cn("text-xs", totalSessions > MAX_SESSIONS ? "text-destructive" : "text-muted-foreground")}>
              {totalSessions} {totalSessions === 1 ? "sessão" : "sessões"} no total (até {MAX_SESSIONS}). Até {MAX_SERVICES} serviços.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="pk-name">Nome</Label>
            <Input
              id="pk-name"
              className="h-11"
              placeholder="Ex.: Mãos & Pés"
              value={name}
              onChange={(e) => setName(e.target.value.slice(0, 80))}
              data-testid="input-pacote-nome"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="pk-price">Preço fechado do pacote</Label>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">R$</span>
              <Input
                id="pk-price"
                className="h-11 pl-9"
                inputMode="numeric"
                value={price}
                onChange={(e) => {
                  setPriceTouched(true);
                  setPrice(maskMoney(e.target.value));
                }}
                data-testid="input-pacote-preco"
              />
            </div>
            {fullPrice > 0 && (
              <p className="text-xs text-muted-foreground" data-testid="texto-pacote-avulso">
                Avulso sairia {brl(fullPrice)}
                {savings > 0.004 && <> · economia de <strong className="text-foreground">{brl(savings)}</strong> para a cliente</>}.
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="pk-validity">Validade (opcional)</Label>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative w-28">
                <Input
                  id="pk-validity"
                  className="h-11 pr-12"
                  inputMode="numeric"
                  placeholder="—"
                  value={validity}
                  onChange={(e) => setValidity(e.target.value.replace(/\D/g, "").slice(0, 3))}
                  data-testid="input-pacote-validade"
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">dias</span>
              </div>
              {VALIDITY_PRESETS.map((d) => (
                <Button
                  key={d}
                  type="button"
                  variant={validity === String(d) ? "default" : "outline"}
                  className="h-11 px-3"
                  onClick={() => setValidity(validity === String(d) ? "" : String(d))}
                  data-testid={`btn-pacote-validade-${d}`}
                >
                  {d}
                </Button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">Vazio = sem validade. Conta a partir do dia da venda.</p>
          </div>

          {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-destructive">{error}</p>}

          <Button type="submit" className="h-12 w-full text-base" disabled={pending} data-testid="btn-salvar-pacote">
            {pending ? <Loader2 className="h-5 w-5 animate-spin" /> : "Salvar"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
