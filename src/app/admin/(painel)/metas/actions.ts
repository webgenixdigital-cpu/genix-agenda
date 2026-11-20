"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getEditorContext } from "@/lib/admin";
import { allows, getPlanContext } from "@/lib/plan";
import { PLAN_ERRORS } from "@/lib/plan-features";
import { GOAL_KINDS, daysBetween, type GoalKind } from "@/lib/goals";

type Result = { ok: true } | { ok: false; error: string };

export type GoalInput = {
  id?: string;
  kind: GoalKind;
  target: number;
  period_start: string;
  period_end: string;
  professional_id: string | null;
};

const NO_ACCESS = "Somente a matriz e a recepção podem mexer nas metas.";

// erros de save_goal / delete_goal (58_metas.sql)
const GOAL_ERRORS: Record<string, string> = {
  SEM_PERMISSAO: NO_ACCESS,
  ...PLAN_ERRORS,
  TIPO_INVALIDO: "Escolha o tipo da meta.",
  VALOR_INVALIDO: "Informe um valor maior que zero (atendimentos e clientes em número inteiro).",
  DATA_INVALIDA: "O período precisa terminar depois do início e ter no máximo 1 ano.",
  NAO_ENCONTRADO: "Essa meta (ou o profissional escolhido) não existe mais.",
};

const ISO = /^\d{4}-\d{2}-\d{2}$/;

function friendly(message: string, fallback: string) {
  const key = Object.keys(GOAL_ERRORS).find((k) => message.includes(k));
  return (key && GOAL_ERRORS[key]) || fallback;
}

async function guard() {
  const ctx = await getEditorContext();
  if (ctx.role !== "owner" && ctx.role !== "reception") return { ctx, error: NO_ACCESS };
  const plan = await getPlanContext(ctx.business.id);
  if (!allows(plan, "profissional")) return { ctx, error: PLAN_ERRORS.PLANO_PROFISSIONAL };
  return { ctx, plan, error: null };
}

// ---------------------------------------------------------------------
// PARTE 1 — Criar / editar (regras no banco: save_goal)
// ---------------------------------------------------------------------
export async function saveGoal(input: GoalInput): Promise<Result> {
  const { ctx, plan, error: denied } = await guard();
  if (denied || !plan) return { ok: false, error: denied ?? NO_ACCESS };

  if (!GOAL_KINDS.includes(input.kind)) return { ok: false, error: GOAL_ERRORS.TIPO_INVALIDO };
  const whole = input.kind === "atendimentos" || input.kind === "clientes_novos";
  if (!(input.target > 0) || (whole && !Number.isInteger(input.target)))
    return { ok: false, error: GOAL_ERRORS.VALOR_INVALIDO };
  const { period_start: start, period_end: end } = input;
  if (!ISO.test(start) || !ISO.test(end) || end < start || daysBetween(start, end) > 366)
    return { ok: false, error: GOAL_ERRORS.DATA_INVALIDA };
  if (input.professional_id && !allows(plan, "equipe")) return { ok: false, error: PLAN_ERRORS.PLANO_EQUIPE };

  const supabase = createClient();
  const { error } = await supabase.rpc("save_goal", {
    p_business: ctx.business.id,
    p_id: input.id ?? null,
    p_kind: input.kind,
    p_target: Math.round(input.target * 100) / 100,
    p_start: start,
    p_end: end,
    p_professional: input.professional_id,
  });
  if (error) return { ok: false, error: friendly(error.message, "Não foi possível salvar a meta.") };

  revalidatePath("/admin/metas");
  return { ok: true };
}

// ---------------------------------------------------------------------
// PARTE 2 — Excluir
// ---------------------------------------------------------------------
export async function deleteGoal(id: string): Promise<Result> {
  const { ctx, error: denied } = await guard();
  if (denied) return { ok: false, error: denied };

  const supabase = createClient();
  const { error } = await supabase.rpc("delete_goal", { p_business: ctx.business.id, p_id: id });
  if (error) return { ok: false, error: friendly(error.message, "Não foi possível excluir a meta.") };

  revalidatePath("/admin/metas");
  return { ok: true };
}
