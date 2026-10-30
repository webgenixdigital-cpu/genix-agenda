"use client";

import { useState, useTransition } from "react";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { deleteRevenueLimit, saveRevenueLimit } from "@/app/genix/limits-actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { brl } from "@/lib/format";
import { REGIME_LABEL, type RevenueLimit } from "@/lib/faturamento";

const REGIMES = ["nanoempreendedor", "mei", "simples"] as const;

/** "81.000,00" / "81000" / "81000.5" → número */
const parseMoney = (v: string) => {
  const s = v.trim();
  if (!s) return null;
  const n = Number(s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s);
  return Number.isFinite(n) ? n : NaN;
};
const toInput = (v: number | null) => (v == null ? "" : String(v).replace(".", ","));

export function RevenueLimitsManager({ limits, today }: { limits: RevenueLimit[]; today: string }) {
  const [editing, setEditing] = useState<RevenueLimit | null>(null);
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();

  // vigente = maior valid_from <= hoje, por enquadramento
  const current = new Set(
    REGIMES.map((r) => limits.filter((l) => l.regime === r && l.valid_from <= today).sort((a, b) => (a.valid_from < b.valid_from ? 1 : -1))[0]?.id)
  );

  function remove(l: RevenueLimit) {
    if (!confirm(`Excluir a vigência de ${l.valid_from.split("-").reverse().join("/")} (${REGIME_LABEL[l.regime]})?`)) return;
    start(async () => {
      const r = await deleteRevenueLimit(l.id);
      if (r.ok) toast.success("Vigência excluída");
      else toast.error(r.error);
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted-foreground">
          Limites usados no Faturamento dos espaços. Vale a vigência com a maior data de início até hoje. Mudança de lei = nova
          vigência (não apague a anterior: ela mantém os anos passados).
        </p>
        <Button
          className="h-11"
          onClick={() => {
            setEditing(null);
            setOpen(true);
          }}
          data-testid="btn-nova-vigencia"
        >
          <Plus className="mr-1.5 h-4 w-4" /> Nova vigência
        </Button>
      </div>

      <ul className="space-y-3">
        {limits.map((l) => (
          <li key={l.id} className="flex flex-wrap items-center gap-3 rounded-2xl border bg-white p-4" data-testid={`limite-${l.id}`}>
            <div className="min-w-0 flex-1">
              <p className="font-semibold">
                {REGIME_LABEL[l.regime]}
                {current.has(l.id) && <span className="ml-2 rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-800">Vigente</span>}
              </p>
              <p className="text-sm text-muted-foreground">
                Desde {l.valid_from.split("-").reverse().join("/")} · {l.basis === "rbt12" ? "RBT12" : "ano civil"}: {brl(l.annual_limit)}
                {l.first_year_monthly ? ` · ano de início: ${brl(l.first_year_monthly)}/mês` : ""}
                {l.sublimit ? ` · sublimite: ${brl(l.sublimit)}` : ""}
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-11 w-11"
              aria-label="Editar"
              onClick={() => {
                setEditing(l);
                setOpen(true);
              }}
              data-testid={`btn-editar-limite-${l.id}`}
            >
              <Pencil className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-11 w-11 text-destructive"
              aria-label="Excluir"
              disabled={pending}
              onClick={() => remove(l)}
              data-testid={`btn-excluir-limite-${l.id}`}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </li>
        ))}
      </ul>

      <LimitDialog open={open} onOpenChange={setOpen} limit={editing} today={today} />
    </div>
  );
}

function LimitDialog({
  open,
  onOpenChange,
  limit,
  today,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  limit: RevenueLimit | null;
  today: string;
}) {
  const [pending, start] = useTransition();
  const [regime, setRegime] = useState<string>("mei");
  const [annual, setAnnual] = useState("");
  const [monthly, setMonthly] = useState("");
  const [sublimit, setSublimit] = useState("");
  const [validFrom, setValidFrom] = useState(today);
  const [loadedId, setLoadedId] = useState<string | null | undefined>(undefined);

  // preenche o formulário ao abrir
  if (open && loadedId !== (limit?.id ?? null)) {
    setLoadedId(limit?.id ?? null);
    setRegime(limit?.regime ?? "mei");
    setAnnual(toInput(limit?.annual_limit ?? null));
    setMonthly(toInput(limit?.first_year_monthly ?? null));
    setSublimit(toInput(limit?.sublimit ?? null));
    setValidFrom(limit?.valid_from ?? today);
  }
  if (!open && loadedId !== undefined) setLoadedId(undefined);

  function submit() {
    const a = parseMoney(annual);
    const m = parseMoney(monthly);
    const s = parseMoney(sublimit);
    if (a == null || Number.isNaN(a) || Number.isNaN(m) || Number.isNaN(s)) {
      toast.error("Confira os valores.");
      return;
    }
    start(async () => {
      const r = await saveRevenueLimit({ id: limit?.id, regime, annualLimit: a, firstYearMonthly: m, sublimit: s, validFrom });
      if (r.ok) {
        toast.success("Limite salvo");
        onOpenChange(false);
      } else toast.error(r.error);
    });
  }

  const isSimples = regime === "simples";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92svh] w-[calc(100%-1.5rem)] max-w-md overflow-y-auto rounded-2xl">
        <DialogHeader>
          <DialogTitle className="font-heading text-2xl">{limit ? "Editar vigência" : "Nova vigência"}</DialogTitle>
          <DialogDescription>Valores em reais. Use vírgula para os centavos.</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="space-y-1.5">
            <Label>Enquadramento</Label>
            <Select value={regime} onValueChange={setRegime}>
              <SelectTrigger className="h-11" data-testid="select-limite-enquadramento"><SelectValue /></SelectTrigger>
              <SelectContent>
                {REGIMES.map((r) => <SelectItem key={r} value={r}>{REGIME_LABEL[r]}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="lm-from">Vale a partir de</Label>
            <Input id="lm-from" type="date" className="h-11" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} data-testid="input-limite-vigencia" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="lm-annual">{isSimples ? "Limite da receita de 12 meses (RBT12)" : "Limite anual"}</Label>
            <Input id="lm-annual" inputMode="decimal" className="h-11" value={annual} onChange={(e) => setAnnual(e.target.value)} data-testid="input-limite-anual" />
          </div>
          {!isSimples && (
            <div className="space-y-1.5">
              <Label htmlFor="lm-monthly">Ano de início: valor por mês de atividade (opcional)</Label>
              <Input id="lm-monthly" inputMode="decimal" className="h-11" value={monthly} onChange={(e) => setMonthly(e.target.value)} data-testid="input-limite-mensal" />
            </div>
          )}
          {isSimples && (
            <div className="space-y-1.5">
              <Label htmlFor="lm-sub">Sublimite de ICMS/ISS (opcional, aviso informativo)</Label>
              <Input id="lm-sub" inputMode="decimal" className="h-11" value={sublimit} onChange={(e) => setSublimit(e.target.value)} data-testid="input-limite-sublimite" />
            </div>
          )}
          <Button type="submit" className="h-12 w-full text-base" disabled={pending} data-testid="btn-salvar-limite">
            {pending ? <Loader2 className="h-5 w-5 animate-spin" /> : "Salvar"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
