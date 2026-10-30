"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { getEditorContext } from "@/lib/admin";
import { getPlanContext, hasTeamFeatures } from "@/lib/plan";
import { createAdminClient } from "@/lib/supabase/admin";

type Result = { ok: true; message?: string } | { ok: false; error: string };

const ONLY_OWNER = "Somente a matriz pode gerenciar acessos.";
const FULL_ONLY = "Acessos individuais da equipe são um recurso do plano Equipe.";

function siteOrigin() {
  const h = headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "genixagenda.com.br";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

const validEmail = (e: string) => /^\S+@\S+\.\S+$/.test(e);

// ---------------------------------------------------------------------
// PARTE 1 — Convidar (profissional ou recepção)
// ---------------------------------------------------------------------
export async function inviteMember(input: {
  role: "staff" | "reception";
  email: string;
  name: string;
  professionalId?: string;
}): Promise<Result> {
  const ctx = await getEditorContext();
  if (ctx.role !== "owner") return { ok: false, error: ONLY_OWNER };
  const plan = await getPlanContext(ctx.business.id);
  if (!hasTeamFeatures(plan)) return { ok: false, error: FULL_ONLY };

  const email = input.email.trim().toLowerCase();
  const name = input.name.trim();
  if (!validEmail(email)) return { ok: false, error: "Informe um e-mail válido." };
  if (name.length < 2) return { ok: false, error: "Informe o nome." };
  if (!["staff", "reception"].includes(input.role)) return { ok: false, error: "Papel inválido." };

  const admin = createAdminClient();

  // profissional precisa existir neste espaço e ainda não ter login
  if (input.role === "staff") {
    const { data: pro } = await admin
      .from("professionals")
      .select("id, user_id")
      .eq("id", input.professionalId ?? "")
      .eq("business_id", ctx.business.id)
      .maybeSingle();
    if (!pro) return { ok: false, error: "Profissional não encontrado." };
    if (pro.user_id) return { ok: false, error: "Este profissional já tem acesso." };
  }

  // cria o login e envia o e-mail de convite
  const { data: invited, error: invErr } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${siteOrigin()}/auth/confirm`,
    data: { full_name: name, invited_to: ctx.business.id },
  });
  if (invErr || !invited?.user) {
    return {
      ok: false,
      error: /already|registered|exists/i.test(invErr?.message ?? "")
        ? "Este e-mail já tem uma conta no Genix Agenda. Use outro e-mail para este acesso."
        : "Não foi possível enviar o convite agora. Tente de novo.",
    };
  }
  const userId = invited.user.id;

  // vincula ao espaço; se falhar, desfaz o login criado
  const { error: memErr } = await admin.from("business_members").insert({
    business_id: ctx.business.id,
    user_id: userId,
    role: input.role,
    invited_email: email,
    display_name: name,
    invited_at: new Date().toISOString(),
  });
  if (memErr) {
    await admin.auth.admin.deleteUser(userId);
    // gatilho da 28a: acessos da equipe só no plano Equipe
    if (memErr.message.includes("PLANO_EQUIPE")) return { ok: false, error: FULL_ONLY };
    return { ok: false, error: "Não foi possível vincular o acesso. Tente de novo." };
  }

  if (input.role === "staff") {
    await admin.from("professionals").update({ user_id: userId }).eq("id", input.professionalId!).eq("business_id", ctx.business.id);
  }

  revalidatePath("/admin/profissionais");
  return { ok: true, message: `Convite enviado para ${email}.` };
}

// ---------------------------------------------------------------------
// PARTE 2 — Reenviar link de acesso (convite expirado ou senha esquecida)
// ---------------------------------------------------------------------
export async function resendAccess(userId: string): Promise<Result> {
  const ctx = await getEditorContext();
  if (ctx.role !== "owner") return { ok: false, error: ONLY_OWNER };

  const admin = createAdminClient();
  const { data: m } = await admin
    .from("business_members")
    .select("invited_email, role")
    .eq("business_id", ctx.business.id)
    .eq("user_id", userId)
    .maybeSingle();
  if (!m?.invited_email || m.role === "owner") return { ok: false, error: "Acesso não encontrado." };

  const { error } = await admin.auth.resetPasswordForEmail(m.invited_email, { redirectTo: `${siteOrigin()}/auth/confirm` });
  if (error) {
    return {
      ok: false,
      error: /rate|seconds|security/i.test(error.message) ? "Aguarde 1 minuto antes de reenviar." : "Não foi possível reenviar agora.",
    };
  }
  return { ok: true, message: `Link de acesso enviado para ${m.invited_email}.` };
}

// ---------------------------------------------------------------------
// PARTE 3 — Remover acesso (apaga o login, mantém o histórico no espaço)
// ---------------------------------------------------------------------
export async function removeAccess(userId: string): Promise<Result> {
  const ctx = await getEditorContext();
  if (ctx.role !== "owner") return { ok: false, error: ONLY_OWNER };
  if (userId === ctx.userId) return { ok: false, error: "Você não pode remover o próprio acesso." };

  const admin = createAdminClient();
  const { data: m } = await admin
    .from("business_members")
    .select("role")
    .eq("business_id", ctx.business.id)
    .eq("user_id", userId)
    .maybeSingle();
  if (!m || m.role === "owner") return { ok: false, error: "Acesso não encontrado." };

  await admin.from("professionals").update({ user_id: null }).eq("business_id", ctx.business.id).eq("user_id", userId);
  await admin.from("business_members").delete().eq("business_id", ctx.business.id).eq("user_id", userId);
  await admin.auth.admin.deleteUser(userId);

  revalidatePath("/admin/profissionais");
  return { ok: true, message: "Acesso removido." };
}
