"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

type Result = { ok: true } | { ok: false; error: string };

const isUuid = (v: string) => /^[0-9a-f-]{36}$/i.test(v);

// ---------------------------------------------------------------------
// Ocultar dos buscadores (migration 30) — só administradores da plataforma.
// A RPC confere is_platform_admin() de novo no banco.
// ---------------------------------------------------------------------
export async function setSearchHidden(businessId: string, slug: string, hidden: boolean): Promise<Result> {
  const supabase = createClient();
  const { data: isAdmin } = await supabase.rpc("is_platform_admin");
  if (!isAdmin) return { ok: false, error: "Acesso negado." };
  if (!isUuid(businessId)) return { ok: false, error: "Espaço inválido." };

  const { error } = await supabase.rpc("genix_set_search_hidden", { p_business_id: businessId, p_hidden: hidden });
  if (error) return { ok: false, error: "Não foi possível salvar. Confira se a migration 30 já foi aplicada." };

  revalidatePath("/genix");
  revalidatePath(`/v/${slug}`);
  revalidatePath("/sitemap.xml");
  return { ok: true };
}
