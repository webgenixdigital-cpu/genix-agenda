"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getEditorContext } from "@/lib/admin";

type Result = { ok: true; id?: string } | { ok: false; error: string };

const digits = (v: string) => {
  const d = v.replace(/\D/g, "");
  return /^55\d{10,11}$/.test(d) ? d.slice(2) : d;
};

function validate(input: { name: string; phone: string; email: string; notes: string }) {
  if (input.name.trim().length < 2) return "Informe o nome do cliente.";
  if (!/^\d{10,11}$/.test(digits(input.phone))) return "Informe o WhatsApp com DDD.";
  if (input.email.trim() && !/^\S+@\S+\.\S+$/.test(input.email.trim())) return "E-mail inválido.";
  if (input.notes.length > 1000) return "Observações: no máximo 1000 caracteres.";
  return null;
}

// ---------------------------------------------------------------------
// PARTE 1 — Cadastrar (matriz e recepção)
// ---------------------------------------------------------------------
export async function createCustomer(input: { name: string; phone: string; email: string; notes: string }): Promise<Result> {
  const { business, role } = await getEditorContext();
  if (role !== "owner" && role !== "reception") return { ok: false, error: "Sem permissão para cadastrar clientes." };
  const err = validate(input);
  if (err) return { ok: false, error: err };

  const supabase = createClient();
  const { data, error } = await supabase
    .from("customers")
    .insert({
      business_id: business.id,
      name: input.name.trim(),
      phone: digits(input.phone),
      email: input.email.trim() || null,
      notes: input.notes.trim() || null,
    })
    .select("id")
    .single();

  if (error) {
    return { ok: false, error: error.code === "23505" ? "Já existe um cliente com esse WhatsApp." : "Não foi possível cadastrar." };
  }
  revalidatePath("/admin/clientes");
  return { ok: true, id: data.id };
}

// ---------------------------------------------------------------------
// PARTE 2 — Editar (quem pode ver o cliente)
// ---------------------------------------------------------------------
export async function updateCustomer(
  id: string,
  input: { name: string; phone: string; email: string; notes: string }
): Promise<Result> {
  const { business } = await getEditorContext();
  const err = validate(input);
  if (err) return { ok: false, error: err };

  const supabase = createClient();
  const { data, error } = await supabase
    .from("customers")
    .update({
      name: input.name.trim(),
      phone: digits(input.phone),
      email: input.email.trim() || null,
      notes: input.notes.trim() || null,
    })
    .eq("id", id)
    .eq("business_id", business.id)
    .select("id");

  if (error) {
    return { ok: false, error: error.code === "23505" ? "Outro cliente já usa esse WhatsApp." : "Não foi possível salvar." };
  }
  if (!data?.length) return { ok: false, error: "Você não tem permissão para editar este cliente." };

  revalidatePath("/admin/clientes");
  revalidatePath(`/admin/clientes/${id}`);
  return { ok: true };
}

// ---------------------------------------------------------------------
// PARTE 3 — Excluir (só a matriz; agendamentos continuam no histórico)
// ---------------------------------------------------------------------
export async function deleteCustomer(id: string): Promise<Result> {
  const { business, role } = await getEditorContext();
  if (role !== "owner") return { ok: false, error: "Somente a matriz pode excluir clientes." };

  const supabase = createClient();
  const { error } = await supabase.from("customers").delete().eq("id", id).eq("business_id", business.id);
  if (error) return { ok: false, error: "Não foi possível excluir." };

  revalidatePath("/admin/clientes");
  return { ok: true };
}
