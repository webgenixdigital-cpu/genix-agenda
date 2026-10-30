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
// PARTE 2.1 — Não enviar lembretes automáticos (matriz e recepção;
// o banco barra os demais papéis)
// ---------------------------------------------------------------------
export async function setCustomerAutoReminders(id: string, optOut: boolean): Promise<Result> {
  const { business, role } = await getEditorContext();
  if (role !== "owner" && role !== "reception") return { ok: false, error: "Somente a matriz e a recepção podem alterar esta opção." };

  const supabase = createClient();
  const { data, error } = await supabase
    .from("customers")
    .update({ no_auto_reminders: optOut })
    .eq("id", id)
    .eq("business_id", business.id)
    .select("id");

  if (error || !data?.length) return { ok: false, error: "Não foi possível salvar a preferência." };
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
  // 23503 = chave estrangeira: customer_packages.customer_id é "on delete restrict"
  if (error?.code === "23503") return { ok: false, error: "Este cliente tem pacotes. Cancele-os antes de excluir." };
  if (error) return { ok: false, error: "Não foi possível excluir." };

  revalidatePath("/admin/clientes");
  return { ok: true };
}

// ---------------------------------------------------------------------
// PARTE 4 — Ficha técnica (campos do nicho do espaço)
// ---------------------------------------------------------------------
export async function updateCustomerProfile(id: string, values: Record<string, string>): Promise<Result> {
  const { business } = await getEditorContext();
  const supabase = createClient();

  // só aceita chaves que existem (e estão ativas) no nicho do espaço
  const { data: fields } = await supabase
    .from("niche_profile_fields")
    .select("key, type, options")
    .eq("niche_id", business.subcategory ?? "")
    .eq("active", true);
  const allowed = new Map((fields ?? []).map((f) => [f.key, f]));

  const { data: current } = await supabase
    .from("customers")
    .select("profile")
    .eq("id", id)
    .eq("business_id", business.id)
    .maybeSingle();
  if (!current) return { ok: false, error: "Cliente não encontrado." };

  const profile: Record<string, string> = { ...((current.profile as Record<string, string>) ?? {}) };
  for (const [key, raw] of Object.entries(values)) {
    const field = allowed.get(key);
    if (!field) continue;
    const value = String(raw ?? "").trim().slice(0, 1000);
    if (field.type === "select" && value && !(field.options as string[]).includes(value)) continue;
    if (value) profile[key] = value;
    else delete profile[key];
  }

  const { data, error } = await supabase
    .from("customers")
    .update({ profile })
    .eq("id", id)
    .eq("business_id", business.id)
    .select("id");
  if (error || !data?.length) return { ok: false, error: "Não foi possível salvar a ficha técnica." };

  revalidatePath(`/admin/clientes/${id}`);
  return { ok: true };
}

// ---------------------------------------------------------------------
// PARTE 5 — Pacotes (venda e cancelamento passam por funções do banco)
// ---------------------------------------------------------------------
const PACKAGE_ERRORS: Record<string, string> = {
  MODELO_INVALIDO: "Esse modelo de pacote não está mais disponível.",
  CLIENTE_INVALIDO: "Cliente não encontrado.",
  SEM_PERMISSAO: "Somente a matriz e a recepção podem vender ou cancelar pacotes.",
  PLANO_GRATIS: "Pacotes são um recurso do plano Completo.",
  FORMA_INVALIDA: "Escolha a forma de pagamento.",
  NAO_ENCONTRADO: "Pacote não encontrado.",
};
const packageError = (message: string, fallback: string) =>
  PACKAGE_ERRORS[Object.keys(PACKAGE_ERRORS).find((k) => message.includes(k)) ?? ""] ?? fallback;

export async function sellPackage(
  customerId: string,
  templateId: string,
  method: "pix" | "dinheiro" | "credito" | "debito" | null
): Promise<Result> {
  await getEditorContext();
  const supabase = createClient();
  const { error } = await supabase.rpc("sell_package", { p_customer: customerId, p_template: templateId, p_method: method });
  if (error) return { ok: false, error: packageError(error.message, "Não foi possível vender o pacote.") };

  revalidatePath(`/admin/clientes/${customerId}`);
  revalidatePath("/admin/financeiro");
  return { ok: true };
}

export async function cancelPackage(customerId: string, packageId: string): Promise<Result> {
  await getEditorContext();
  const supabase = createClient();
  const { error } = await supabase.rpc("cancel_customer_package", { p_package: packageId });
  if (error) return { ok: false, error: packageError(error.message, "Não foi possível cancelar o pacote.") };

  revalidatePath(`/admin/clientes/${customerId}`);
  return { ok: true };
}
