"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getEditorContext, requireRoles } from "@/lib/admin";
import { getPlanContext } from "@/lib/plan";
import { getProvider, type InstanceRow } from "@/lib/whatsapp/provider";

type Result = { ok: true } | { ok: false; error: string };

// ---------------------------------------------------------------------
// PARTE 1 — Só a matriz (demonstração, recepção e profissional não passam)
// ---------------------------------------------------------------------
async function ownerContext() {
  await getEditorContext(); // demonstração: redireciona com ?demo=bloqueado
  return requireRoles(["owner"]); // recepção/profissional: volta ao Início
}

/** Instância do próprio espaço, lida com o client de serviço (credenciais não saem do servidor) */
async function ownProvider(businessId: string) {
  const db = createAdminClient();
  const { data: inst } = await db
    .from("whatsapp_instances")
    .select("provider, instance_id, token, client_token, genix_enabled")
    .eq("business_id", businessId)
    .maybeSingle();
  if (!inst?.genix_enabled) return { db, provider: null };
  return { db, provider: getProvider(inst as InstanceRow) };
}

async function saveStatus(db: ReturnType<typeof createAdminClient>, businessId: string, connected: boolean) {
  await db
    .from("whatsapp_instances")
    .update({ status: connected ? "connected" : "disconnected", status_checked_at: new Date().toISOString() })
    .eq("business_id", businessId);
}

function refresh() {
  revalidatePath("/admin/configuracoes");
  revalidatePath("/admin", "layout"); // aviso de desconexão no painel
}

// ---------------------------------------------------------------------
// PARTE 2 — Conexão: QR Code e status
// ---------------------------------------------------------------------
export async function getWhatsappQr(): Promise<
  { ok: true; image: string } | { ok: true; connected: true } | { ok: false; error: string }
> {
  const { business } = await ownerContext();
  if ((await getPlanContext(business.id)).tier !== "completo") return { ok: false, error: "Recurso do plano Completo." };

  const { db, provider } = await ownProvider(business.id);
  if (!provider) return { ok: false, error: "O WhatsApp automático ainda não foi liberado para o seu espaço." };

  const qr = await provider.qrCode();
  if (!qr.ok) return { ok: false, error: "Não foi possível gerar o QR Code agora. Tente de novo em instantes." };
  if ("connected" in qr) {
    await saveStatus(db, business.id, true);
    refresh();
    return { ok: true, connected: true };
  }
  return { ok: true, image: qr.image };
}

export async function refreshWhatsappStatus(): Promise<{ ok: true; connected: boolean } | { ok: false; error: string }> {
  const { business } = await ownerContext();
  if ((await getPlanContext(business.id)).tier !== "completo") return { ok: false, error: "Recurso do plano Completo." };

  const { db, provider } = await ownProvider(business.id);
  if (!provider) return { ok: false, error: "O WhatsApp automático ainda não foi liberado para o seu espaço." };

  const st = await provider.status();
  if (!st.ok) return { ok: false, error: "Não foi possível conferir a conexão agora. Tente de novo em instantes." };
  await saveStatus(db, business.id, st.connected);
  refresh();
  return { ok: true, connected: st.connected };
}

// ---------------------------------------------------------------------
// PARTE 3 — Ligar/desligar e textos (regras conferidas no banco)
// ---------------------------------------------------------------------
const AUTO_ERRORS: Record<string, string> = {
  SEM_PERMISSAO: "Somente a matriz pode alterar esta opção.",
  PLANO_GRATIS: "Recurso do plano Completo.",
  NAO_HABILITADO: "O WhatsApp automático ainda não foi liberado para o seu espaço.",
  ACEITE_OBRIGATORIO: "Para ativar, confirme que leu o aviso de risco.",
};

export async function setWhatsappAuto(enabled: boolean, acceptRisk: boolean): Promise<Result> {
  const { business } = await ownerContext();
  const supabase = createClient();
  const { error } = await supabase.rpc("set_whatsapp_auto", {
    p_business: business.id,
    p_enabled: enabled,
    p_accept_risk: acceptRisk,
  });
  if (error) {
    const code = Object.keys(AUTO_ERRORS).find((k) => error.message.includes(k));
    return { ok: false, error: code ? AUTO_ERRORS[code] : "Não foi possível salvar." };
  }
  refresh();
  return { ok: true };
}

export async function saveWhatsappTemplates(a: string, b: string): Promise<Result> {
  const { business } = await ownerContext();
  if (a.length > 1000 || b.length > 1000) return { ok: false, error: "Cada texto pode ter no máximo 1000 caracteres." };

  const supabase = createClient();
  const { error } = await supabase.rpc("save_whatsapp_templates", { p_business: business.id, p_a: a, p_b: b });
  if (error) return { ok: false, error: "Não foi possível salvar os textos." };
  refresh();
  return { ok: true };
}
