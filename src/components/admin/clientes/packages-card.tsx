"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Loader2, Lock, Package, Plus } from "lucide-react";
import { toast } from "sonner";
import { cancelPackage, sellPackage } from "@/app/admin/(painel)/clientes/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { METHOD_LABEL, type CashMethod } from "@/lib/cash";
import { brl } from "@/lib/format";
import { cn } from "@/lib/utils";

export type CustomerPackage = {
  id: string;
  name: string;
  service_name: string;
  sessions_total: number;
  used: number;
  remaining: number;
  price: number;
  sold_at: string;
  expires_at: string | null;
  effective_status: "active" | "finished" | "expired" | "cancelled";
  sessions: { id: string; booking_date: string; start_time: string; professional_name: string; status: string }[];
};

export type SaleTemplate = { id: string; name: string; sessions: number; price: number; validity_days: number | null };

const br = (iso: string) => iso.split("-").reverse().join("/");

const STATUS: Record<CustomerPackage["effective_status"], { label: string; cls: string }> = {
  active: { label: "Ativo", cls: "bg-green-100 text-green-800" },
  finished: { label: "Concluído", cls: "bg-stone-100 text-stone-700" },
  expired: { label: "Vencido", cls: "bg-amber-100 text-amber-800" },
  cancelled: { label: "Cancelado", cls: "bg-red-50 text-destructive" },
};

const SESSION_STATUS: Record<string, string> = {
  pending: "agendada",
  confirmed: "agendada",
  completed: "realizada",
  cancelled: "cancelada (devolvida)",
};

export function PackagesCard({
  customerId,
  packages,
  templates,
  canSell,
  locked,
}: {
  customerId: string;
  packages: CustomerPackage[];
  templates: SaleTemplate[];
  canSell: boolean; // matriz ou recepção
  locked: boolean;  // plano Grátis: vender fica travado; sessões já vendidas continuam
}) {
  const [sellOpen, setSellOpen] = useState(false);
  const [toCancel, setToCancel] = useState<CustomerPackage | null>(null);
  const [pending, start] = useTransition();

  function confirmCancel() {
    if (!toCancel) return;
    start(async () => {
      const r = await cancelPackage(customerId, toCancel.id);
      if (!r) return; // demonstração: o servidor redirecionou
      if (r.ok) {
        toast.success("Pacote cancelado");
        setToCancel(null);
      } else toast.error(r.error);
    });
  }

  return (
    <section className="space-y-3" data-testid="card-pacotes">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-2xl">Pacotes</h2>
        {canSell && !locked && (
          <Button className="h-11" onClick={() => setSellOpen(true)} disabled={templates.length === 0} data-testid="btn-vender-pacote">
            <Plus className="mr-1.5 h-4 w-4" /> Vender pacote
          </Button>
        )}
        {canSell && locked && (
          <Button asChild variant="outline" className="h-11" data-testid="btn-liberar-pacotes">
            <Link href="/admin/assinatura">
              <Lock className="mr-1.5 h-4 w-4" /> Vender pacote · planos pagos
            </Link>
          </Button>
        )}
      </div>

      {canSell && !locked && templates.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Cadastre os modelos de pacote em <Link href="/admin/servicos" className="underline">Serviços</Link>.
        </p>
      )}

      {packages.length === 0 ? (
        <p className="rounded-2xl border border-dashed bg-white p-6 text-center text-muted-foreground">Nenhum pacote.</p>
      ) : (
        <ul className="space-y-3">
          {packages.map((p) => {
            const st = STATUS[p.effective_status];
            return (
              <li key={p.id} className="rounded-2xl border bg-card p-4" data-testid={`pacote-${p.id}`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 gap-3">
                    <Package className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold">{p.name}</p>
                        <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", st.cls)}>{st.label}</span>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {p.service_name} · {brl(p.price)} · vendido em {br(p.sold_at.slice(0, 10))}
                        {" · "}
                        {p.expires_at ? `vale até ${br(p.expires_at)}` : "sem validade"}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-heading text-2xl">
                      {p.remaining}
                      <span className="text-base text-muted-foreground">/{p.sessions_total}</span>
                    </p>
                    <p className="text-xs text-muted-foreground">{p.remaining === 1 ? "sessão restante" : "sessões restantes"}</p>
                  </div>
                </div>

                {p.sessions.length > 0 && (
                  <ol className="mt-3 space-y-1 border-l-2 border-secondary pl-3 text-xs text-muted-foreground">
                    {p.sessions.map((s) => (
                      <li key={s.id}>
                        <span className="font-semibold text-foreground">{br(s.booking_date)} às {s.start_time.slice(0, 5)}</span>
                        {" · "}{s.professional_name} · {SESSION_STATUS[s.status] ?? s.status}
                      </li>
                    ))}
                  </ol>
                )}

                {canSell && p.effective_status !== "cancelled" && (
                  <div className="mt-3 flex justify-end border-t pt-3">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-11 text-muted-foreground hover:bg-red-50 hover:text-destructive"
                      onClick={() => setToCancel(p)}
                      data-testid={`btn-cancelar-pacote-${p.id}`}
                    >
                      Cancelar pacote
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <SellPackageDialog open={sellOpen} onOpenChange={setSellOpen} customerId={customerId} templates={templates} />

      {/* Cancelar pacote: avisa que não há estorno automático */}
      <Dialog open={!!toCancel} onOpenChange={(o) => !o && setToCancel(null)}>
        <DialogContent className="max-h-[92svh] w-[calc(100%-1.5rem)] max-w-md overflow-y-auto rounded-2xl">
          <DialogHeader>
            <DialogTitle className="font-heading text-2xl">Cancelar pacote?</DialogTitle>
            <DialogDescription>
              {toCancel?.name} · restam {toCancel?.remaining} de {toCancel?.sessions_total} sessões.
            </DialogDescription>
          </DialogHeader>
          <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
            O valor não é estornado automaticamente. Se devolver dinheiro, lance a saída no Financeiro.
          </p>
          <p className="text-sm text-muted-foreground">
            Sessões já agendadas continuam na agenda e podem ser concluídas ou canceladas normalmente.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row-reverse">
            <Button variant="destructive" className="h-11" disabled={pending} onClick={confirmCancel} data-testid="btn-confirmar-cancelar-pacote">
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Cancelar pacote"}
            </Button>
            <Button variant="outline" className="h-11" onClick={() => setToCancel(null)} data-testid="btn-voltar-cancelar-pacote">
              Voltar
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function SellPackageDialog({
  open,
  onOpenChange,
  customerId,
  templates,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  customerId: string;
  templates: SaleTemplate[];
}) {
  const [pending, start] = useTransition();
  const [templateId, setTemplateId] = useState("");
  const [method, setMethod] = useState<CashMethod | "">("");
  const [error, setError] = useState<string | null>(null);
  const t = templates.find((x) => x.id === templateId);

  function submit() {
    setError(null);
    if (!t) return setError("Escolha o pacote.");
    if (t.price > 0 && !method) return setError("Escolha a forma de pagamento.");
    start(async () => {
      const r = await sellPackage(customerId, t.id, t.price > 0 ? (method as CashMethod) : null);
      if (!r) return; // demonstração: o servidor redirecionou
      if (r.ok) {
        toast.success(t.price > 0 ? "Pacote vendido e lançado no caixa" : "Pacote registrado");
        setTemplateId("");
        setMethod("");
        onOpenChange(false);
      } else setError(r.error);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92svh] w-[calc(100%-1.5rem)] max-w-md overflow-y-auto rounded-2xl">
        <DialogHeader>
          <DialogTitle className="font-heading text-2xl">Vender pacote</DialogTitle>
          <DialogDescription>Pagamento presencial. O valor total entra no caixa uma vez, agora.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Pacote</Label>
            <Select value={templateId} onValueChange={setTemplateId}>
              <SelectTrigger className="h-11" data-testid="select-vender-pacote"><SelectValue placeholder="Escolha o pacote" /></SelectTrigger>
              <SelectContent className="max-h-64">
                {templates.map((x) => (
                  <SelectItem key={x.id} value={x.id}>{x.name} · {brl(x.price)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {t && (
              <p className="text-xs text-muted-foreground">
                {t.sessions} sessões · {t.validity_days ? `validade de ${t.validity_days} dias a partir de hoje` : "sem validade"}
              </p>
            )}
          </div>

          {t && t.price > 0 && (
            <div className="space-y-1.5">
              <Label>Forma de pagamento</Label>
              <div className="grid grid-cols-2 gap-2">
                {(Object.keys(METHOD_LABEL) as CashMethod[]).map((m) => (
                  <Button
                    key={m}
                    type="button"
                    variant={method === m ? "default" : "outline"}
                    className="h-11"
                    onClick={() => setMethod(m)}
                    data-testid={`btn-pacote-forma-${m}`}
                  >
                    {METHOD_LABEL[m]}
                  </Button>
                ))}
              </div>
            </div>
          )}

          {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-destructive">{error}</p>}

          <Button className="h-12 w-full text-base" disabled={pending} onClick={submit} data-testid="btn-confirmar-venda-pacote">
            {pending ? <Loader2 className="h-5 w-5 animate-spin" /> : t ? `Confirmar venda · ${brl(t.price)}` : "Confirmar venda"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
