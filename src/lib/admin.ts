// Contexto do painel: usuário logado + estabelecimento dele.
// cache() evita repetir a consulta no layout e na página da mesma requisição.
import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Business } from "@/lib/types";

export type AdminContext = {
  userId: string;
  email: string;
  role: "owner" | "reception" | "staff" | "viewer";
  /** profissional ligado a este login (matriz e profissionais; recepção = null) */
  professionalId: string | null;
  /** e-mail confirmado pelo link enviado (confirmação posterior ao cadastro) */
  emailVerified: boolean;
  business: Business & { id: string; timezone: string; is_published: boolean; is_demo: boolean };
};

// ---------------------------------------------------------------------
// PARTE 1 — Leitura (páginas do painel)
// ---------------------------------------------------------------------
export const getAdminContext = cache(async (): Promise<AdminContext> => {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/admin/login");

  const { data } = await supabase
    .from("business_members")
    .select("role, businesses(*)")
    .eq("user_id", user.id)
    .order("created_at")
    .limit(1)
    .maybeSingle();

  if (!data?.businesses) redirect("/cadastro");

  const biz = data.businesses as unknown as AdminContext["business"];
  const { data: pro } = await supabase
    .from("professionals")
    .select("id")
    .eq("business_id", biz.id)
    .eq("user_id", user.id)
    .order("active", { ascending: false })
    .limit(1)
    .maybeSingle();

  return {
    userId: user.id,
    email: user.email ?? "",
    professionalId: pro?.id ?? null,
    emailVerified: !!user.user_metadata?.email_verified_at,
    role: data.role as AdminContext["role"],
    business: biz,
  };
});

// ---------------------------------------------------------------------
// PARTE 2 — Escrita (server actions)
// Na demonstração (viewer), não salva nada: volta para a mesma página
// com ?demo=bloqueado, que abre o convite para criar a conta.
// ---------------------------------------------------------------------
export async function getEditorContext(): Promise<AdminContext> {
  const ctx = await getAdminContext();

  if (ctx.role === "viewer") {
    let path = "/admin";
    try {
      const ref = headers().get("referer");
      if (ref) path = new URL(ref).pathname;
    } catch {
      /* mantém /admin */
    }
    redirect(`${path}?demo=bloqueado`);
  }

  return ctx;
}

// ---------------------------------------------------------------------
// PARTE 3 — Páginas exclusivas de alguns papéis
// Ex.: await requireRoles(["owner", "viewer"]) → recepção/profissional vão ao Início
// ---------------------------------------------------------------------
export async function requireRoles(allowed: AdminContext["role"][]): Promise<AdminContext> {
  const ctx = await getAdminContext();
  if (!allowed.includes(ctx.role)) redirect("/admin");
  return ctx;
}

/** Quem enxerga a agenda de toda a equipe */
export const seesWholeTeam = (role: AdminContext["role"]) => role === "owner" || role === "reception" || role === "viewer";
