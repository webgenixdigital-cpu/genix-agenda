"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getEditorContext } from "@/lib/admin";
import { removeReplacedImage } from "@/lib/images";
import { EXTRA_OVERDUE, previewTeamChange, SCHEDULED_DOWNGRADE, syncIfPending, type BillingPreview } from "@/lib/billing";

type Result = { ok: true } | { ok: false; error: string };

const FREE_LIMIT =
  "No plano Grátis é possível ter 1 profissional ativo. Para montar sua equipe, assine o plano Equipe.";
const PRO_LIMIT =
  "O plano Profissional é para 1 profissional ativo. Para montar sua equipe, mude para o plano Equipe.";
const STALE = "O valor da assinatura mudou desde o aviso. Confira o novo valor e tente de novo.";

// erro do gatilho de limite (28a e 29): Grátis, Profissional, avulsa vencida ou troca agendada
const limitError = (message?: string) =>
  message?.includes("LIMITE_PLANO_PROFISSIONAL") ? PRO_LIMIT
  : message?.includes("LIMITE_PLANO_GRATIS") ? FREE_LIMIT
  : message?.includes("EXTRA_EM_ABERTO") ? EXTRA_OVERDUE
  : message?.includes("TROCA_AGENDADA") ? SCHEDULED_DOWNGRADE
  : null;

export type ProfessionalInput = {
  id?: string;
  name: string;
  role: string;
  bio: string;
  photo_url: string;
  specialties: string[];
  commission_pct: number;
  is_partner: boolean;       // salão-parceiro (Lei 13.352)
  allServices: boolean;      // true = faz todos (sem vínculos)
  serviceIds: string[];      // usado quando allServices = false
};

function refresh(slug: string) {
  revalidatePath("/admin/profissionais");
  revalidatePath("/admin/agenda");
  revalidatePath("/admin/assinatura");
  revalidatePath(`/v/${slug}`);
}

// ---------------------------------------------------------------------
// PARTE 0 — Cobrança do profissional extra (migration 29)
// O aviso vem antes; a action confere que o valor ainda é o mesmo que a
// matriz confirmou (ack). A sincronia com o Asaas roda depois de salvar e
// nunca impede a ativação: se falhar, fica "a sincronizar".
// ---------------------------------------------------------------------
export async function previewProfessionalBilling(delta: 1 | -1): Promise<BillingPreview> {
  const { business, role } = await getEditorContext();
  if (role !== "owner") return { ok: true, message: null, expected: null };
  return previewTeamChange(business.id, delta);
}

/** antes de ativar/cadastrar: bloqueios e valor confirmado */
async function checkActivation(businessId: string, ack: number | null | undefined): Promise<Result> {
  const pre = await previewTeamChange(businessId, 1);
  if (!pre.ok) return pre;
  if (pre.message && (ack == null || Math.round(ack * 100) !== Math.round((pre.expected ?? 0) * 100))) {
    return { ok: false, error: STALE };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------
// PARTE 1 — Criar / editar (inclui serviços que a pessoa faz)
// ---------------------------------------------------------------------
export async function saveProfessional(input: ProfessionalInput, ack?: number | null): Promise<Result> {
  const { business } = await getEditorContext();
  const supabase = createClient();

  const name = input.name.trim();
  if (name.length < 2) return { ok: false, error: "Informe o nome." };
  if (!(input.commission_pct >= 0 && input.commission_pct <= 100)) {
    return { ok: false, error: "A comissão precisa estar entre 0 e 100%." };
  }
  if (!input.allServices && input.serviceIds.length === 0) {
    return { ok: false, error: "Marque pelo menos um serviço ou ligue “Faz todos os serviços”." };
  }
  const photo = input.photo_url.trim();
  if (photo && !/^https:\/\//.test(photo)) return { ok: false, error: "O link da foto precisa começar com https://" };

  const row = {
    name,
    role: input.role.trim() || null,
    bio: input.bio.trim() || null,
    photo_url: photo || null,
    specialties: input.specialties.map((s) => s.trim()).filter(Boolean).slice(0, 8),
    commission_pct: input.commission_pct,
    is_partner: !!input.is_partner,
  };

  let id = input.id;
  if (id) {
    const { data: before } = await supabase
      .from("professionals").select("photo_url").eq("id", id).eq("business_id", business.id).maybeSingle();
    const { error } = await supabase.from("professionals").update(row).eq("id", id).eq("business_id", business.id);
    if (error) return { ok: false, error: "Não foi possível salvar." };
    // foto trocada ou removida: apaga a antiga do Storage (só se for nossa)
    await removeReplacedImage(supabase, business.id, before?.photo_url, row.photo_url);
  } else {
    // cadastro novo nasce ativo: passa pela regra do profissional extra
    const check = await checkActivation(business.id, ack);
    if (!check.ok) return check;
    const { data: last } = await supabase
      .from("professionals").select("sort_order").eq("business_id", business.id)
      .order("sort_order", { ascending: false }).limit(1).maybeSingle();
    const { data, error } = await supabase
      .from("professionals")
      .insert({ ...row, business_id: business.id, sort_order: (last?.sort_order ?? 0) + 1 })
      .select("id")
      .single();
    if (limitError(error?.message)) return { ok: false, error: limitError(error?.message)! };
    if (error || !data) return { ok: false, error: "Não foi possível cadastrar." };
    id = data.id;
  }

  // serviços: apaga os vínculos e grava de novo (vazio = faz todos)
  await supabase.from("professional_services").delete().eq("professional_id", id);
  if (!input.allServices) {
    const { data: valid } = await supabase
      .from("services").select("id").eq("business_id", business.id).in("id", input.serviceIds);
    const rows = (valid ?? []).map((s) => ({ professional_id: id!, service_id: s.id }));
    if (rows.length) await supabase.from("professional_services").insert(rows);
  }

  if (!input.id) await syncIfPending(business.id, "cadastrou", [id!]);
  refresh(business.slug);
  return { ok: true };
}

// ---------------------------------------------------------------------
// PARTE 2 — Ativar / desativar
// ---------------------------------------------------------------------
export async function toggleProfessional(id: string, active: boolean, ack?: number | null): Promise<Result> {
  const { business } = await getEditorContext();
  const supabase = createClient();

  if (active) {
    const check = await checkActivation(business.id, ack);
    if (!check.ok) return check;
  } else {
    const { count } = await supabase
      .from("professionals").select("id", { count: "exact", head: true })
      .eq("business_id", business.id).eq("active", true);
    if ((count ?? 0) <= 1) return { ok: false, error: "É preciso ter pelo menos 1 profissional ativo." };
  }

  const { error } = await supabase.from("professionals").update({ active }).eq("id", id).eq("business_id", business.id);
  if (limitError(error?.message)) return { ok: false, error: limitError(error?.message)! };
  if (error) return { ok: false, error: "Não foi possível atualizar." };
  await syncIfPending(business.id, active ? "ativou" : "desativou", [id]);
  refresh(business.slug);
  return { ok: true };
}

// ---------------------------------------------------------------------
// PARTE 3 — Excluir (só sem histórico de atendimentos)
// ---------------------------------------------------------------------
export async function deleteProfessional(id: string): Promise<Result> {
  const { business } = await getEditorContext();
  const supabase = createClient();

  const { count } = await supabase
    .from("bookings").select("id", { count: "exact", head: true }).eq("professional_id", id);
  if ((count ?? 0) > 0) {
    return { ok: false, error: "Essa pessoa tem atendimentos no histórico. Desative em vez de excluir." };
  }

  const { error } = await supabase.from("professionals").delete().eq("id", id).eq("business_id", business.id);
  if (error) return { ok: false, error: "Não foi possível excluir." };
  await syncIfPending(business.id, "excluiu");
  refresh(business.slug);
  return { ok: true };
}
