"use client";

// 4b — Motoristas do leva e traz (só a matriz). O link do app do motorista entra na 4c.
import { useState, useTransition } from "react";
import { Copy, Link2, Link2Off, Loader2, MessageCircle, Pencil, Plus, UserRound } from "lucide-react";
import { toast } from "sonner";
import { generateDriverLink, revokeDriverLink, saveDriver } from "@/app/admin/(painel)/leva-e-traz/actions";
import { whatsappLink } from "@/lib/format";
import type { DriverRow } from "@/components/admin/leva-e-traz/routes-board";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

export function DriversCard({ drivers, links, businessName }: {
  drivers: DriverRow[];
  /** 66: motorista com link ligado */
  links: Record<string, boolean>;
  businessName: string;
}) {
  // link recém-gerado (só aparece agora; depois, só gerando outro)
  const [fresh, setFresh] = useState<{ driver: DriverRow; url: string } | null>(null);
  const [linkPending, startLink] = useTransition();

  function newLink(d: DriverRow) {
    startLink(async () => {
      const r = await generateDriverLink(d.id);
      if (!r) return;
      if (!r.ok) return void toast.error(r.error);
      setFresh({ driver: d, url: `${window.location.origin}/motorista/${r.token}` });
    });
  }
  function offLink(d: DriverRow) {
    startLink(async () => {
      const r = await revokeDriverLink(d.id);
      if (!r) return;
      if (r.ok) toast.success(`Link de ${d.name} desligado`);
      else toast.error(r.error);
    });
  }
  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link copiado");
    } catch {
      toast.error("Não foi possível copiar. Selecione e copie o link.");
    }
  }

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
                <p className="text-xs text-muted-foreground">{links[d.id] ? "Link do app ligado" : "Sem link do app"}</p>
                <div className="mt-1 flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" className="h-10" disabled={linkPending || !d.active} onClick={() => newLink(d)}
                    data-testid="btn-gerar-link-motorista">
                    <Link2 className="mr-1.5 h-4 w-4" /> {links[d.id] ? "Gerar novo link" : "Gerar link"}
                  </Button>
                  {links[d.id] && (
                    <Button variant="ghost" size="sm" className="h-10 text-destructive" disabled={linkPending} onClick={() => offLink(d)}
                      data-testid="btn-desligar-link-motorista">
                      <Link2Off className="mr-1.5 h-4 w-4" /> Desligar
                    </Button>
                  )}
                </div>
              </div>
              <Button variant="ghost" size="icon" className="h-11 w-11" onClick={() => openDialog(d)} aria-label={`Editar ${d.name}`}
                data-testid="btn-editar-motorista">
                <Pencil className="h-4 w-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      {/* link recém-gerado: copiar ou mandar pelo WhatsApp do motorista */}
      <Dialog open={!!fresh} onOpenChange={(o) => !o && setFresh(null)}>
        <DialogContent className="max-h-[92svh] w-[calc(100%-1.5rem)] max-w-md overflow-y-auto rounded-2xl">
          <DialogHeader>
            <DialogTitle className="font-heading text-2xl">Link de {fresh?.driver.name}</DialogTitle>
            <DialogDescription>
              Quem tiver este link vê as paradas do dia dele, com endereços dos clientes. Envie só para o motorista. Gerar um novo link desliga este.
            </DialogDescription>
          </DialogHeader>
          {fresh && (
            <div className="space-y-3">
              <p className="break-all rounded-xl bg-secondary p-3 text-sm" data-testid="link-motorista-gerado">{fresh.url}</p>
              <Button className="h-11 w-full" variant="outline" onClick={() => copy(fresh.url)} data-testid="btn-copiar-link-motorista">
                <Copy className="mr-1.5 h-4 w-4" /> Copiar link
              </Button>
              {fresh.driver.phone && (
                <Button asChild className="h-11 w-full bg-whatsapp text-white hover:bg-whatsapp/90">
                  <a
                    href={whatsappLink(fresh.driver.phone, `Olá, ${fresh.driver.name.split(" ")[0]}! Este é o seu link do leva e traz de ${businessName}. Abra no celular para ver a rota do dia:\n${fresh.url}`) ?? "#"}
                    target="_blank"
                    rel="noopener noreferrer"
                    data-testid="btn-enviar-link-motorista"
                  >
                    <MessageCircle className="mr-1.5 h-4 w-4" /> Enviar pelo WhatsApp
                  </a>
                </Button>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[92svh] w-[calc(100%-1.5rem)] max-w-md overflow-y-auto rounded-2xl">
          <DialogHeader>
            <DialogTitle className="font-heading text-2xl">{editing ? "Editar motorista" : "Novo motorista"}</DialogTitle>
            <DialogDescription>Depois de salvar, gere o link do app do motorista na lista.</DialogDescription>
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
