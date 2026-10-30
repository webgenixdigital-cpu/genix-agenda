"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

type Result = { ok: true } | { ok: false; error: string };

const REGIMES = ["nanoempreendedor", "mei", "simples"] as const;

async function isAdmin() {
  const { data } = await createClient().rpc("is_platform_admin");
  return data === true;
}

const money = (v: number | null) => (v == null ? null : Math.round(v * 100) / 100);

// ---------------------------------------------------------------------
// PARTE 1 — Criar / editar vigência de limite
// O RLS (is_platform_admin) também barra quem não é da Genix.
// ---------------------------------------------------------------------
export async function saveRevenueLimit(input: {
  id?: string;
  regime: string;
  annualLimit: number;
  firstYearMonthly: number | null;
  sublimit: number | null;
  validFrom: string;
}): Promise<Result> {
  if (!(await isAdmin())) return { ok: false, error: "Acesso negado." };
  if (!REGIMES.includes(input.regime as (typeof REGIMES)[number])) return { ok: false, error: "Enquadramento inválido." };
  if (!(input.annualLimit > 0)) return { ok: false, error: "Informe o limite." };
  if (input.firstYearMonthly != null && !(input.firstYearMonthly > 0)) return { ok: false, error: "Valor por mês inválido." };
  if (input.sublimit != null && !(input.sublimit > 0 && input.sublimit <= input.annualLimit)) {
    return { ok: false, error: "O sublimite precisa ser maior que zero e até o limite." };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.validFrom)) return { ok: false, error: "Informe a data de vigência." };

  const row = {
    regime: input.regime,
    basis: input.regime === "simples" ? "rbt12" : "annual",
    annual_limit: money(input.annualLimit),
    first_year_monthly: input.regime === "simples" ? null : money(input.firstYearMonthly),
    sublimit: input.regime === "simples" ? money(input.sublimit) : null,
    valid_from: input.validFrom,
  };

  const supabase = createClient();
  const { error } = input.id
    ? await supabase.from("revenue_limits").update(row).eq("id", input.id)
    : await supabase.from("revenue_limits").insert(row);
  if (error?.code === "23505") return { ok: false, error: "Já existe uma vigência com essa data para esse enquadramento." };
  if (error) return { ok: false, error: "Não foi possível salvar." };

  revalidatePath("/genix");
  return { ok: true };
}

export async function deleteRevenueLimit(id: string): Promise<Result> {
  if (!(await isAdmin())) return { ok: false, error: "Acesso negado." };
  const { error } = await createClient().from("revenue_limits").delete().eq("id", id);
  if (error) return { ok: false, error: "Não foi possível excluir." };
  revalidatePath("/genix");
  return { ok: true };
}
