"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { defaultProviderName, getProvider, INSTANCE_COLUMNS, type InstanceRow } from "@/lib/whatsapp/provider";

type Result = { ok: true } | { ok: false; error: string };

// ---------------------------------------------------------------------
// PARTE 1 — Só administradores da plataforma
// As credenciais são gravadas e lidas com o client de serviço e nunca
// voltam para o navegador.
// ---------------------------------------------------------------------
async function isAdmin() {
  const supabase = createClient();
  const { data } = await supabase.rpc("is_platform_admin");
  return data === true;
}

const isUuid = (v: string) => /^[0-9a-f-]{36}$/i.test(v);
const clean = (v: string | undefined) => (v ?? "").trim();

// ---------------------------------------------------------------------
// PARTE 2 — Cadastrar instância / liberar o recurso
// Campo vazio = mantém o valor já cadastrado.
// ---------------------------------------------------------------------
export async function saveWhatsappInstance(input: {
  businessId: string;
  enabled: boolean;
  instanceId?: string;
  token?: string;
  clientToken?: string;
}): Promise<Result> {
  if (!(await isAdmin())) return { ok: false, error: "Acesso negado." };
  if (!isUuid(input.businessId)) return { ok: false, error: "Espaço inválido." };

  const fields = { instance_id: clean(input.instanceId), token: clean(input.token), client_token: clean(input.clientToken) };
  for (const v of Object.values(fields)) {
    if (v && !/^[A-Za-z0-9_-]{6,200}$/.test(v)) return { ok: false, error: "Credencial com formato inválido." };
  }

  const db = createAdminClient();
  const { data: current } = await db
    .from("whatsapp_instances")
    .select("provider, instance_id, token, client_token")
    .eq("business_id", input.businessId)
    .maybeSingle();

  // Evolution: a instância é criada pelo próprio espaço (QR Code); aqui só liberamos o envio
  const zapiReady = !!current?.instance_id && !!current?.token && !!current?.client_token;
  const typedCreds = Object.values(fields).some(Boolean);
  if (current?.provider === "evolution" || (!zapiReady && !typedCreds && defaultProviderName() === "evolution")) {
    const { error } = current
      ? await db.from("whatsapp_instances").update({ genix_enabled: input.enabled }).eq("business_id", input.businessId)
      : await db.from("whatsapp_instances").insert({ business_id: input.businessId, provider: "evolution", genix_enabled: input.enabled });
    if (error) return { ok: false, error: "Não foi possível salvar a liberação." };
    revalidatePath("/genix");
    return { ok: true };
  }

  const row: Record<string, string | boolean | null> = {
    business_id: input.businessId,
    genix_enabled: input.enabled,
    instance_id: fields.instance_id || current?.instance_id || null,
    token: fields.token || current?.token || null,
    client_token: fields.client_token || current?.client_token || null,
  };
  if (input.enabled && (!row.instance_id || !row.token || !row.client_token)) {
    return { ok: false, error: "Para liberar, cadastre instance id, token e client-token." };
  }

  // trocou de instância: o status antigo não vale mais
  const changed =
    !current || row.instance_id !== current.instance_id || row.token !== current.token || row.client_token !== current.client_token;

  if (changed) {
    row.status = "unknown";
    row.status_checked_at = null;
  }
  const { error } = await db.from("whatsapp_instances").upsert(row, { onConflict: "business_id" });
  if (error) return { ok: false, error: "Não foi possível salvar a instância." };

  revalidatePath("/genix");
  return { ok: true };
}

// ---------------------------------------------------------------------
// PARTE 3 — Testar conexão da instância
// ---------------------------------------------------------------------
export async function testWhatsappInstance(businessId: string): Promise<{ ok: true; connected: boolean } | { ok: false; error: string }> {
  if (!(await isAdmin())) return { ok: false, error: "Acesso negado." };
  if (!isUuid(businessId)) return { ok: false, error: "Espaço inválido." };

  const db = createAdminClient();
  const { data: inst } = await db
    .from("whatsapp_instances")
    .select(INSTANCE_COLUMNS)
    .eq("business_id", businessId)
    .maybeSingle();
  const provider = inst ? getProvider(inst as InstanceRow) : null;
  if (!provider) return { ok: false, error: "Instância ainda não conectada pelo espaço ou sem credenciais completas." };

  const st = await provider.status();
  if (!st.ok) return { ok: false, error: "O serviço de WhatsApp não respondeu. Tente de novo em instantes." };

  await db
    .from("whatsapp_instances")
    .update({ status: st.connected ? "connected" : "disconnected", status_checked_at: new Date().toISOString() })
    .eq("business_id", businessId);

  revalidatePath("/genix");
  return { ok: true, connected: st.connected };
}
