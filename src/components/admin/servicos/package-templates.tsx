"use client";

import { useState, useTransition } from "react";
import { Loader2, Package, Pencil, Plus, Trash2 } from "lucide-react";
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

export type PackageTemplate = {
  id: string;
  service_id: string;
  name: string;
  sessions: number;
  price: number;
  validity_days: number | null;
  active: boolean;
};

type ServiceOption = { id: string; name: string; price: number };

const VALIDITY_PRESETS = [30, 60, 90, 180];

export function PackageTemplates({ templates, services }: { templates: PackageTemplate[]; services: ServiceOption[] }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<PackageTemplate | null>(null);
  const [pending, start] = useTransition();
  const serviceName = (id: string) => services.find((s) => s.id === id)?.name ?? "Serviço excluído";

  function toggle(id: string, active: boolean) {
    start(async () => {
      const r = await togglePackageTemplate(id, active);
      if (!r) return; // demonstração: o servidor redirecionou
      if (!r.ok) toast.error(r.error);
    });
  }

  function remove(t: PackageTemplate) {
    if (!confirm(`Excluir o modelo "${t.name}"? Pacotes já vendidos continuam valendo.`)) return;
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
          <h2 className="text-2xl">Pacotes</h2>
          <p className="text-sm text-muted-foreground">Modelos para vender na ficha do cliente (ex.: 10 sessões de drenagem).</p>
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
                  {t.sessions}× {serviceName(t.service_id)} · <strong className="text-foreground">{brl(t.price)}</strong>
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
  const [serviceId, setServiceId] = useState("");
  const [name, setName] = useState("");
  const [sessions, setSessions] = useState("10");
  const [price, setPrice] = useState("0,00");
  const [validity, setValidity] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loadedId, setLoadedId] = useState<string | null | undefined>(undefined);

  // preenche o formulário ao abrir
  if (open && loadedId !== (template?.id ?? null)) {
    setLoadedId(template?.id ?? null);
    setServiceId(template?.service_id ?? "");
    setName(template?.name ?? "");
    setSessions(String(template?.sessions ?? 10));
    setPrice(maskMoney(String(Math.round((template?.price ?? 0) * 100))));
    setValidity(template?.validity_days ? String(template.validity_days) : "");
    setError(null);
  }
  if (!open && loadedId !== undefined) setLoadedId(undefined);

  const service = services.find((s) => s.id === serviceId);
  const n = Number(sessions) || 0;
  const fullPrice = service ? service.price * n : 0;

  function pickService(id: string) {
    setServiceId(id);
    const s = services.find((x) => x.id === id);
    // sugere nome e preço cheio; a matriz ajusta o desconto
    if (s && !name.trim()) setName(`${n || 10}× ${s.name}`.slice(0, 80));
    if (s && parseMoney(price) === 0) setPrice(maskMoney(String(Math.round(s.price * (n || 10) * 100))));
  }

  function submit() {
    setError(null);
    start(async () => {
      const r = await savePackageTemplate({
        id: template?.id,
        service_id: serviceId,
        name,
        sessions: n,
        price: parseMoney(price),
        validity_days: validity ? Number(validity) : null,
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
          <div className="space-y-1.5">
            <Label>Serviço</Label>
            <Select value={serviceId} onValueChange={pickService}>
              <SelectTrigger className="h-11" data-testid="select-pacote-servico"><SelectValue placeholder="Escolha o serviço" /></SelectTrigger>
              <SelectContent className="max-h-64">
                {services.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="pk-name">Nome</Label>
            <Input id="pk-name" className="h-11" value={name} onChange={(e) => setName(e.target.value.slice(0, 80))} data-testid="input-pacote-nome" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="pk-sessions">Sessões</Label>
              <Input
                id="pk-sessions"
                className="h-11"
                inputMode="numeric"
                value={sessions}
                onChange={(e) => setSessions(e.target.value.replace(/\D/g, "").slice(0, 3))}
                data-testid="input-pacote-sessoes"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pk-price">Preço do pacote</Label>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">R$</span>
                <Input
                  id="pk-price"
                  className="h-11 pl-9"
                  inputMode="numeric"
                  value={price}
                  onChange={(e) => setPrice(maskMoney(e.target.value))}
                  data-testid="input-pacote-preco"
                />
              </div>
            </div>
          </div>
          {service && n > 0 && (
            <p className="-mt-2 text-xs text-muted-foreground">
              Avulso sairia {brl(fullPrice)} ({n}× {brl(service.price)}).
            </p>
          )}

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
