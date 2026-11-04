"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getEditorContext, requireRoles } from "@/lib/admin";
import { getPlanContext } from "@/lib/plan";
import {
  defaultProviderName,
  getProvider,
  INSTANCE_COLUMNS,
  type InstanceRow,
  type QrResult,
} from "@/lib/whatsapp/provider";
import { createEvolutionInstance, evolutionConfigured } from "@/lib/whatsapp/evolution";

type Result = { ok: true } | { ok: false; error: string };
type Db = ReturnType<typeof createAdminClient>;
type Row = InstanceRow & { genix_enabled: boolean };

const PAID_ONLY = "Recurso dos planos Profissional e Equipe.";
const NOT_RELEASED = "O WhatsApp automático ainda não foi liberado para o seu espaço.";

// ---------------------------------------------------------------------
// PARTE 1 — Só a matriz, num plano pago (conferido no servidor em TODA action)
// ---------------------------------------------------------------------
async function ownerContext() {
  await getEditorContext(); // demonstração: redireciona com ?demo=bloqueado
  return requireRoles(["owner"]); // recepção/profissional: volta ao Início
}

/** Matriz + plano pago. Devolve o espaço ou a mensagem de erro. */
async function paidOwner(): Promise<{ businessId: string } | { error: string }> {
  const { business } = await ownerContext();
  if ((await getPlanContext(business.id)).tier !== "completo") return { error: PAID_ONLY };
  return { businessId: business.id };
}

async function loadRow(db: Db, businessId: string) {
  const { data } = await db
    .from("whatsapp_instances")
    .select(`${INSTANCE_COLUMNS}, genix_enabled`)
    .eq("business_id", businessId)
    .maybeSingle();
  return (data as Row | null) ?? null;
}

/** Linha que usa a Evolution: provider evolution, ou ainda sem credenciais da Z-API com a env em evolution */
function usesEvolution(row: Row | null) {
  if (row?.provider === "evolution") return true;
  const zapiReady = !!row?.instance_id && !!row?.token && !!row?.client_token;
  return defaultProviderName() === "evolution" && !zapiReady;
}

/** Nome da instância a partir do espaço: genix_<12 primeiros hex do uuid> */
const instanceNameFor = (businessId: string) => `genix_${businessId.replace(/-/g, "").slice(0, 12).toLowerCase()}`;

/**
 * Garante a linha da Evolution com nome + token (gerados aqui e gravados ANTES
 * de chamar o servidor: se a chamada falhar, nada fica órfão).
 * Não mexe em genix_enabled (a liberação continua com a Genix).
 */
async function ensureEvolutionRow(db: Db, businessId: string, row: Row | null) {
  if (row?.provider === "evolution" && row.instance_name && row.token) return { row, fresh: false };
  const next = {
    business_id: businessId,
    provider: "evolution",
    instance_name: instanceNameFor(businessId),
    token: randomBytes(24).toString("hex"),
    instance_id: null,
    client_token: null,
    phone_number: null,
    status: "disconnected",
    status_checked_at: new Date().toISOString(),
  };
  const { error } = await db.from("whatsapp_instances").upsert(next, { onConflict: "business_id" });
  if (error) return null;
  return { row: { ...next, genix_enabled: row?.genix_enabled ?? false } as Row, fresh: true };
}

async function saveStatus(db: Db, businessId: string, connected: boolean, phone?: string | null) {
  const patch: Record<string, string | null> = {
    status: connected ? "connected" : "disconnected",
    status_checked_at: new Date().toISOString(),
  };
  if (phone !== undefined) patch.phone_number = phone;
  await db.from("whatsapp_instances").update(patch).eq("business_id", businessId);
}

function refresh() {
  revalidatePath("/admin/configuracoes");
  revalidatePath("/admin", "layout"); // aviso de desconexão no painel
}

// ---------------------------------------------------------------------
// PARTE 2 — Conectar: cria a instância (se não existe) e devolve o QR
// ---------------------------------------------------------------------
export type QrResponse =
  | { ok: true; image: string }
  | { ok: true; connected: true; phone: string | null }
  /** QR ainda sendo gerado: o navegador tenta de novo em instantes */
  | { ok: true; waiting: true }
  | { ok: false; error: string };

export async function getWhatsappQr(): Promise<QrResponse> {
  const ctx = await paidOwner();
  if ("error" in ctx) return { ok: false, error: ctx.error };
  const db = createAdminClient();
  let row = await loadRow(db, ctx.businessId);

  let qr: QrResult;
  if (usesEvolution(row)) {
    if (!evolutionConfigured()) return { ok: false, error: "A conexão do WhatsApp está indisponível no momento. Fale com a Genix." };
    const ensured = await ensureEvolutionRow(db, ctx.businessId, row);
    if (!ensured) return { ok: false, error: "Não foi possível preparar a conexão. Tente de novo." };
    row = ensured.row;

    const provider = getProvider(row);
    if (!provider) return { ok: false, error: "Não foi possível preparar a conexão. Tente de novo." };

    qr = ensured.fresh ? { ok: false, reason: "INEXISTENTE" } : await provider.qrCode();
    // instância ainda não existe no servidor (primeira vez ou foi apagada lá): cria com o mesmo token
    if (!qr.ok && (qr.reason === "INEXISTENTE" || qr.reason === "NAO_AUTORIZADO")) {
      qr = await createEvolutionInstance(row.instance_name!, row.token!);
    }
  } else {
    // Z-API: credenciais cadastradas pela Genix, só depois da liberação
    if (!row?.genix_enabled) return { ok: false, error: NOT_RELEASED };
    const provider = getProvider(row);
    if (!provider) return { ok: false, error: NOT_RELEASED };
    qr = await provider.qrCode();
  }

  if (!qr.ok) {
    if (qr.reason === "AGUARDANDO") return { ok: true, waiting: true };
    return { ok: false, error: "Não foi possível gerar o QR Code agora. Tente de novo em instantes." };
  }
  if ("connected" in qr) {
    const phone = (await getProvider(row!)?.ownerPhone?.()) ?? null;
    await saveStatus(db, ctx.businessId, true, phone);
    refresh();
    return { ok: true, connected: true, phone };
  }
  return { ok: true, image: qr.image };
}

// ---------------------------------------------------------------------
// PARTE 3 — Estado da conexão (o QR consulta a cada poucos segundos)
// Só grava/revalida quando o estado muda.
// ---------------------------------------------------------------------
export async function refreshWhatsappStatus(): Promise<
  { ok: true; connected: boolean; phone: string | null } | { ok: false; error: string }
> {
  const ctx = await paidOwner();
  if ("error" in ctx) return { ok: false, error: ctx.error };
  const db = createAdminClient();
  const row = await loadRow(db, ctx.businessId);
  if (!row) return { ok: true, connected: false, phone: null };
  if (row.provider === "zapi" && !row.genix_enabled) return { ok: false, error: NOT_RELEASED };

  const provider = getProvider(row);
  if (!provider) return { ok: true, connected: false, phone: null };

  const st = await provider.status();
  if (!st.ok) return { ok: false, error: "Não foi possível conferir a conexão agora. Tente de novo em instantes." };

  const { data: before } = await db
    .from("whatsapp_instances")
    .select("status, phone_number")
    .eq("business_id", ctx.businessId)
    .maybeSingle();
  let phone: string | null = (before?.phone_number as string | null) ?? null;
  if (st.connected && !phone && provider.ownerPhone) phone = await provider.ownerPhone();

  const changed = before?.status !== (st.connected ? "connected" : "disconnected") || phone !== before?.phone_number;
  await saveStatus(db, ctx.businessId, st.connected, st.connected ? phone : undefined);
  if (changed) refresh();
  return { ok: true, connected: st.connected, phone: st.connected ? phone : null };
}

// ---------------------------------------------------------------------
// PARTE 4 — Desconectar (logout; a instância continua para reconectar)
// ---------------------------------------------------------------------
export async function disconnectWhatsapp(): Promise<Result> {
  const ctx = await paidOwner();
  if ("error" in ctx) return { ok: false, error: ctx.error };
  const db = createAdminClient();
  const row = await loadRow(db, ctx.businessId);
  const provider = row ? getProvider(row) : null;
  if (!provider?.logout) return { ok: false, error: "Este WhatsApp é desconectado pela equipe Genix. Fale com a gente." };

  const r = await provider.logout();
  if (!r.ok) return { ok: false, error: "Não foi possível desconectar agora. Tente de novo em instantes." };
  await saveStatus(db, ctx.businessId, false, null);
  refresh();
  return { ok: true };
}

// ---------------------------------------------------------------------
// PARTE 5 — Ligar/desligar e textos (regras conferidas no banco)
// ---------------------------------------------------------------------
const AUTO_ERRORS: Record<string, string> = {
  SEM_PERMISSAO: "Somente a matriz pode alterar esta opção.",
  PLANO_GRATIS: PAID_ONLY,
  NAO_HABILITADO: NOT_RELEASED,
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
