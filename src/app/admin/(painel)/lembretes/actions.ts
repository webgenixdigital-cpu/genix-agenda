"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getEditorContext } from "@/lib/admin";

export async function markReminderSent(id: string, sent: boolean): Promise<{ ok: boolean; error?: string }> {
  const { business } = await getEditorContext();
  const supabase = createClient();

  const { error } = await supabase
    .from("bookings")
    .update({ reminder_sent_at: sent ? new Date().toISOString() : null })
    .eq("id", id)
    .eq("business_id", business.id);

  if (error) return { ok: false, error: "Não foi possível registrar o lembrete." };
  revalidatePath("/admin/lembretes");
  return { ok: true };
}
export async function markReturnContacted(id: string, contacted: boolean): Promise<{ ok: boolean; error?: string }> {
  const { business } = await getEditorContext();
  const supabase = createClient();

  const { error } = await supabase
    .from("bookings")
    .update({ return_contacted_at: contacted ? new Date().toISOString() : null })
    .eq("id", id)
    .eq("business_id", business.id)
    .eq("status", "completed");

  if (error) return { ok: false, error: "Não foi possível registrar o contato." };
  revalidatePath("/admin/lembretes");
  return { ok: true };
}

// ---------------------------------------------------------------------
// Textos da fila manual "Amanhã" e "Hoje" (41_nascimento_texto_lembrete)
// Vazio = texto padrão. Matriz e recepção; o banco confere o papel de novo.
// ---------------------------------------------------------------------
const TEXT_ERRORS: Record<string, string> = {
  SEM_PERMISSAO: "Somente a matriz e a recepção podem editar a mensagem.",
  DADOS_INVALIDOS: "Cada texto pode ter no máximo 1000 caracteres.",
};

export async function saveManualReminderTexts(
  tomorrow: string,
  today: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { business, role } = await getEditorContext();
  if (role !== "owner" && role !== "reception") return { ok: false, error: TEXT_ERRORS.SEM_PERMISSAO };
  if (tomorrow.length > 1000 || today.length > 1000) return { ok: false, error: TEXT_ERRORS.DADOS_INVALIDOS };

  const supabase = createClient();
  const { error } = await supabase.rpc("save_manual_reminder_texts", {
    p_business: business.id,
    p_tomorrow: tomorrow,
    p_today: today,
  });
  if (error) {
    const key = Object.keys(TEXT_ERRORS).find((k) => error.message.includes(k));
    return { ok: false, error: key ? TEXT_ERRORS[key] : "Não foi possível salvar a mensagem." };
  }
  revalidatePath("/admin/lembretes");
  return { ok: true };
}
