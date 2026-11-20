"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { saveGoal } from "@/app/admin/(painel)/metas/actions";
import { maskMoney, parseMoney } from "@/components/admin/servicos/service-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { GOAL_KINDS, GOAL_LABEL, isMoneyGoal, monthRange, type GoalKind, type GoalWithProgress } from "@/lib/goals";
import { cn } from "@/lib/utils";

export type ProfessionalOption = { id: string; name: string };

const ALL = "todos";

const HINT: Record<GoalKind, string> = {
  faturamento: "Entradas do caixa no período, pela data do pagamento.",
  atendimentos: "Atendimentos concluídos no período, pela data do atendimento.",
  ticket_medio: "Valor médio cobrado por atendimento pago no período.",
  clientes_novos: "Clientes que fizeram o primeiro atendimento no período.",
};

export function GoalDialog({
  open,
  onOpenChange,
  goal,
  today,
  professionals,
  team,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  goal: GoalWithProgress | null; // null = nova
  today: string;
  professionals: ProfessionalOption[];
  team: boolean;
}) {
  const [pending, start] = useTransition();
  const [kind, setKind] = useState<GoalKind>("faturamento");
  const [money, setMoney] = useState("0,00");
  const [qty, setQty] = useState("");
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [pro, setPro] = useState(ALL);
  const [error, setError] = useState<string | null>(null);
  const [loadedId, setLoadedId] = useState<string | null | undefined>(undefined);

  const thisMonth = monthRange(today);
  const nextMonth = monthRange(today, 1);

  // preenche o formulário ao abrir
  if (open && loadedId !== (goal?.id ?? null)) {
    setLoadedId(goal?.id ?? null);
    const k = goal?.kind ?? "faturamento";
    setKind(k);
    setMoney(maskMoney(String(Math.round((goal && isMoneyGoal(k) ? goal.target : 0) * 100))));
    setQty(goal && !isMoneyGoal(k) ? String(Math.round(goal.target)) : "");
    setFrom(goal?.period_start ?? thisMonth.start);
    setTo(goal?.period_end ?? thisMonth.end);
    setPro(goal?.professional_id ?? ALL);
    setError(null);
  }
  if (!open && loadedId !== undefined) setLoadedId(undefined);

  // profissional que saiu da equipe continua aparecendo na meta antiga
  const options =
    goal?.professional_id && !professionals.some((p) => p.id === goal.professional_id)
      ? [...professionals, { id: goal.professional_id, name: goal.professional_name ?? "Profissional removido" }]
      : professionals;

  const isRange = (r: { start: string; end: string }) => from === r.start && to === r.end;

  function submit() {
    setError(null);
    const target = isMoneyGoal(kind) ? parseMoney(money) : Number(qty);
    if (!(target > 0)) return setError("Informe a meta (maior que zero).");
    if (!isMoneyGoal(kind) && !Number.isInteger(target)) return setError("Use um número inteiro.");
    if (!from || !to || to < from) return setError("O período precisa terminar depois do início.");
    start(async () => {
      const r = await saveGoal({
        id: goal?.id,
        kind,
        target,
        period_start: from,
        period_end: to,
        professional_id: team && pro !== ALL ? pro : null,
      });
      if (!r) return; // demonstração: o servidor redirecionou
      if (r.ok) {
        toast.success(goal ? "Meta atualizada" : "Meta criada");
        onOpenChange(false);
      } else setError(r.error);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92svh] w-[calc(100%-1.5rem)] max-w-md overflow-y-auto rounded-2xl">
        <DialogHeader>
          <DialogTitle className="font-heading text-2xl">{goal ? "Editar meta" : "Nova meta"}</DialogTitle>
          <DialogDescription>Escolha o que medir, o valor e o período.</DialogDescription>
        </DialogHeader>

        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="space-y-1.5">
            <Label>O que medir</Label>
            <Select value={kind} onValueChange={(v) => setKind(v as GoalKind)}>
              <SelectTrigger className="h-11" data-testid="select-tipo-meta">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {GOAL_KINDS.map((k) => (
                  <SelectItem key={k} value={k}>
                    {GOAL_LABEL[k]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{HINT[kind]}</p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="meta-valor">Meta</Label>
            {isMoneyGoal(kind) ? (
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                  R$
                </span>
                <Input
                  id="meta-valor"
                  inputMode="numeric"
                  className="h-12 pl-10 text-lg"
                  value={money}
                  onChange={(e) => setMoney(maskMoney(e.target.value))}
                  data-testid="input-valor-meta"
                />
              </div>
            ) : (
              <Input
                id="meta-valor"
                type="number"
                inputMode="numeric"
                min={1}
                step={1}
                className="h-12 text-lg"
                placeholder={kind === "atendimentos" ? "Ex.: 80" : "Ex.: 10"}
                value={qty}
                onChange={(e) => setQty(e.target.value.replace(/\D/g, "").slice(0, 6))}
                data-testid="input-valor-meta"
              />
            )}
          </div>

          <div className="space-y-1.5">
            <Label>Período</Label>
            <div className="flex flex-wrap gap-2">
              {[
                { label: "Este mês", r: thisMonth, id: "mes" },
                { label: "Próximo mês", r: nextMonth, id: "proximo-mes" },
              ].map(({ label, r, id }) => (
                <Button
                  key={id}
                  type="button"
                  variant="outline"
                  className={cn("h-11", isRange(r) && "border-primary bg-secondary")}
                  aria-pressed={isRange(r)}
                  onClick={() => {
                    setFrom(r.start);
                    setTo(r.end);
                  }}
                  data-testid={`btn-periodo-meta-${id}`}
                >
                  {label}
                </Button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="meta-de" className="text-xs text-muted-foreground">
                  De
                </Label>
                <Input
                  id="meta-de"
                  type="date"
                  className="h-11"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                  data-testid="input-inicio-meta"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="meta-ate" className="text-xs text-muted-foreground">
                  Até
                </Label>
                <Input
                  id="meta-ate"
                  type="date"
                  className="h-11"
                  min={from}
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  data-testid="input-fim-meta"
                />
              </div>
            </div>
          </div>

          {team && (
            <div className="space-y-1.5">
              <Label>De quem</Label>
              <Select value={pro} onValueChange={setPro}>
                <SelectTrigger className="h-11" data-testid="select-profissional-meta">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>Todo o espaço</SelectItem>
                  {options.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {pro !== ALL && (kind === "faturamento" || kind === "ticket_medio") && (
                <p className="text-xs text-muted-foreground">
                  Na meta do profissional, venda de pacote e de produto não entram.
                </p>
              )}
            </div>
          )}

          {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-destructive">{error}</p>}

          <Button type="submit" className="h-12 w-full text-base" disabled={pending} data-testid="btn-salvar-meta">
            {pending ? <Loader2 className="h-5 w-5 animate-spin" /> : goal ? "Salvar meta" : "Criar meta"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
