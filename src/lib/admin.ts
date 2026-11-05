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
type ServerClient = ReturnType<typeof createClient>;
type MemberRow = {
  role: string;
  businesses: (AdminContext["business"] & { professionals?: { id: string; user_id?: string | null }[] }) | null;
};

/** id do usuário lido do token da sessão (só uma dica para adiantar a consulta; quem valida é o getUser) */
function tokenSub(accessToken: string | undefined): string | null {
  try {
    const payload = accessToken?.split(".")[1];
    if (!payload) return null;
    const sub = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"))?.sub;
    return typeof sub === "string" ? sub : null;
  } catch {
    return null;
  }
}

/**
 * Espaço do login + profissional ligado a ele, numa ida só (embed de professionals).
 * O RLS é o mesmo das duas consultas separadas de antes. Se o embed falhar, devolve null
 * e o chamador usa o caminho antigo.
 */
async function loadMember(supabase: ServerClient, userId: string): Promise<MemberRow | null> {
  const { data, error } = await supabase
    .from("business_members")
    .select("role, businesses(*, professionals(id, user_id))")
    .eq("user_id", userId)
    .eq("businesses.professionals.user_id", userId)
    .order("created_at")
    .order("active", { referencedTable: "businesses.professionals", ascending: false })
    .limit(1, { referencedTable: "businesses.professionals" })
    .limit(1)
    .maybeSingle();
  if (error) return null;
  const row = data as unknown as MemberRow | null;
  if (!row) return { role: "", businesses: null };
  // conferência: o embed só pode trazer o profissional deste login; senão, caminho antigo
  const pros = row.businesses?.professionals;
  if (row.businesses && (!Array.isArray(pros) || pros.some((p) => p.user_id !== userId))) return null;
  return row;
}

/** Caminho antigo (2 consultas em sequência): só se o embed acima falhar */
async function loadMemberLegacy(supabase: ServerClient, userId: string): Promise<MemberRow> {
  const { data } = await supabase
    .from("business_members")
    .select("role, businesses(*)")
    .eq("user_id", userId)
    .order("created_at")
    .limit(1)
    .maybeSingle();
  const biz = (data?.businesses ?? null) as unknown as AdminContext["business"] | null;
  if (!data || !biz) return { role: data?.role ?? "", businesses: null };
  const { data: pro } = await supabase
    .from("professionals")
    .select("id")
    .eq("business_id", biz.id)
    .eq("user_id", userId)
    .order("active", { ascending: false })
    .limit(1)
    .maybeSingle();
  return { role: data.role, businesses: { ...biz, professionals: pro ? [pro] : [] } };
}

export const getAdminContext = cache(async (): Promise<AdminContext> => {
  const supabase = createClient();

  // Sessão do cookie (leitura local; o middleware já renovou o token). Com ela, a consulta do
  // espaço sai junto com a validação do login no Auth, em vez de esperar por ela.
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  const hintId = tokenSub(token);

  const [userRes, early] = await Promise.all([
    token ? supabase.auth.getUser(token) : supabase.auth.getUser(),
    hintId ? loadMember(supabase, hintId) : Promise.resolve(null),
  ]);
  let user = userRes.data.user;
  // token recusado (ex.: expirou no meio do caminho): valida do jeito antigo, com renovação
  if (!user && token && userRes.error) user = (await supabase.auth.getUser()).data.user;
  if (!user) redirect("/admin/login");

  // só aproveita a consulta adiantada se ela foi feita para o mesmo usuário validado
  let member = early && hintId === user.id ? early : null;
  if (!member) member = await loadMember(supabase, user.id);
  if (!member) member = await loadMemberLegacy(supabase, user.id);

  if (!member.businesses) redirect("/cadastro");

  const { professionals, ...biz } = member.businesses;

  return {
    userId: user.id,
    email: user.email ?? "",
    professionalId: professionals?.[0]?.id ?? null,
    emailVerified: !!user.user_metadata?.email_verified_at,
    role: member.role as AdminContext["role"],
    business: biz as AdminContext["business"],
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
