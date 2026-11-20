"use client";

import { useState, useTransition } from "react";
import { Pencil, Plus, Target, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { deleteGoal } from "@/app/admin/(painel)/metas/actions";
import { GoalDialog, type ProfessionalOption } from "@/components/admin/metas/goal-dialog";
import { Button } from "@/components/ui/button";
import { brl } from "@/lib/format";
import { GOAL_LABEL, goalPace, isMoneyGoal, type GoalStatus, type GoalWithProgress } from "@/lib/goals";
import { cn } from "@/lib/utils";

const br = (iso: string) => iso.split("-").reverse().join("/");

const STATUS_STYLE: Record<GoalStatus, string> = {
  concluida: "bg-emerald-50 text-emerald-800 ring-emerald-600/30",
  no_ritmo: "bg-sky-50 text-sky-800 ring-sky-600/30",
  abaixo: "bg-amber-50 text-amber-900 ring-amber-600/30",
  encerrada: "bg-stone-100 text-stone-700 ring-stone-500/30",
  futura: "bg-stone-100 text-stone-700 ring-stone-500/30",
};

const BAR_STYLE: Record<GoalStatus, string> = {
  concluida: "bg-emerald-600",
  no_ritmo: "bg-primary",
  abaixo: "bg-amber-500",
  encerrada: "bg-stone-400",
  futura: "bg-stone-300",
};

function statusLabel(status: GoalStatus, g: GoalWithProgress) {
  if (status === "concluida") return "Meta batida";
  if (status === "encerrada") return "Encerrada";
  if (status === "futura") return "Ainda não começou";
  if (g.kind === "ticket_medio") return "Abaixo da meta";
  return status === "no_ritmo" ? "No ritmo" : "Abaixo do ritmo";
}

const amount = (g: GoalWithProgress, v: number) =>
  isMoneyGoal(g.kind) ? brl(v) : Math.round(v).toLocaleString("pt-BR");

export function GoalsList({
  goals,
  today,
  professionals,
  team,
}: {
  goals: GoalWithProgress[];
  today: string;
  professionals: ProfessionalOption[];
  /** plano Equipe: metas por profissional */
  team: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<GoalWithProgress | null>(null);
  const [pending, start] = useTransition();

  const current = goals.filter((g) => g.period_start <= today && g.period_end >= today);
  const future = goals.filter((g) => g.period_start > today);
  const past = goals.filter((g) => g.period_end < today);

  function remove(g: GoalWithProgress) {
    if (!confirm(`Excluir a meta de ${GOAL_LABEL[g.kind].toLowerCase()} (${br(g.period_start)} a ${br(g.period_end)})?`)) return;
    start(async () => {
      const r = await deleteGoal(g.id);
      if (!r) return; // demonstração: o servidor redirecionou
      if (r.ok) toast.success("Meta excluída");
      else toast.error(r.error);
    });
  }

  function card(g: GoalWithProgress) {
    const p = goalPace(g, today);
    const who = g.professional_id ? g.professional_name ?? "Profissional removido" : "Todo o espaço";
    const isTicket = g.kind === "ticket_medio";
    return (
      <li key={g.id} className="rounded-2xl border bg-card p-4 md:p-5" data-testid={`meta-${g.id}`}>
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-semibold">{GOAL_LABEL[g.kind]}</p>
              <span
                className={cn("rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset", STATUS_STYLE[p.status])}
                data-testid={`meta-status-${g.id}`}
              >
                {statusLabel(p.status, g)}
              </span>
            </div>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {who} · {br(g.period_start)} a {br(g.period_end)}
            </p>
          </div>
          <div className="flex shrink-0 gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-11 w-11"
              aria-label="Editar meta"
              onClick={() => {
                setEditing(g);
                setOpen(true);
              }}
              data-testid={`btn-editar-meta-${g.id}`}
            >
              <Pencil className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-11 w-11 text-destructive hover:text-destructive"
              aria-label="Excluir meta"
              disabled={pending}
              onClick={() => remove(g)}
              data-testid={`btn-excluir-meta-${g.id}`}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="mt-3 flex items-baseline justify-between gap-3 text-sm">
          <p>
            <span className="text-lg font-semibold">{amount(g, g.realized)}</span>{" "}
            <span className="text-muted-foreground">de {amount(g, g.target)}</span>
          </p>
          <p className="font-semibold">{p.pct}%</p>
        </div>
        <div
          className="mt-2 h-2.5 overflow-hidden rounded-full bg-secondary"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.min(p.pct, 100)}
          aria-label={`${GOAL_LABEL[g.kind]}: ${p.pct}% da meta`}
        >
          <div className={cn("h-full rounded-full", BAR_STYLE[p.status])} style={{ width: `${Math.min(p.pct, 100)}%` }} />
        </div>

        <p className="mt-2 text-sm text-muted-foreground" data-testid={`meta-ritmo-${g.id}`}>
          {p.status === "futura" && `Começa em ${br(g.period_start)}.`}
          {p.status === "concluida" && "Parabéns, a meta foi alcançada!"}
          {p.status === "encerrada" && `Faltaram ${amount(g, p.missing)}.`}
          {(p.status === "no_ritmo" || p.status === "abaixo") &&
            (isTicket
              ? `Média de ${g.base_count} atendimento${g.base_count === 1 ? "" : "s"} pago${g.base_count === 1 ? "" : "s"}. Faltam ${p.daysLeft} dia${p.daysLeft === 1 ? "" : "s"}.`
              : `Faltam ${amount(g, p.missing)} em ${p.daysLeft} dia${p.daysLeft === 1 ? "" : "s"} · cerca de ${
                  isMoneyGoal(g.kind) ? brl(p.perDay ?? 0) : (p.perDay ?? 0).toLocaleString("pt-BR", { maximumFractionDigits: 1 })
                }/dia`)}
        </p>
      </li>
    );
  }

  const section = (title: string, items: GoalWithProgress[], testid: string) =>
    items.length > 0 && (
      <section className="space-y-3" data-testid={testid}>
        <h2 className="font-heading text-xl">{title}</h2>
        <ul className="space-y-3">{items.map(card)}</ul>
      </section>
    );

  return (
    <div className="space-y-8">
      <div className="flex justify-center">
        <Button
          className="h-12 gap-2 px-5"
          onClick={() => {
            setEditing(null);
            setOpen(true);
          }}
          data-testid="btn-nova-meta"
        >
          <Plus className="h-4 w-4" /> Nova meta
        </Button>
      </div>

      {goals.length === 0 ? (
        <div className="rounded-2xl border border-dashed bg-white p-10 text-center">
          <Target className="mx-auto h-8 w-8 text-primary" />
          <p className="mt-2 font-heading text-2xl">Nenhuma meta ainda</p>
          <p className="mt-2 text-muted-foreground">
            Comece pelo faturamento do mês: a tela mostra quanto falta e quanto precisa por dia.
          </p>
        </div>
      ) : (
        <>
          {section("Em andamento", current, "secao-metas-andamento")}
          {section("Próximas", future, "secao-metas-proximas")}
          {section("Encerradas", past, "secao-metas-encerradas")}
        </>
      )}

      <GoalDialog
        open={open}
        onOpenChange={setOpen}
        goal={editing}
        today={today}
        professionals={professionals}
        team={team}
      />
    </div>
  );
}
