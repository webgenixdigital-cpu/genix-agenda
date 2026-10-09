// Contexto do painel: usuário logado + estabelecimento dele.
// cache() evita repetir a consulta no layout e na página da mesma requisição.
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Business } from "@/lib/types";

export type AdminContext = {
  userId: string;
  email: string;
  role: "owner" | "staff";
  business: Business & { id: string; timezone: string; is_published: boolean };
};

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

  if (!data?.businesses) redirect("/admin/login?erro=sem-estabelecimento");

  return {
    userId: user.id,
    email: user.email ?? "",
    role: data.role as AdminContext["role"],
    business: data.businesses as unknown as AdminContext["business"],
  };
});