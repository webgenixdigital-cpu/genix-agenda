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
