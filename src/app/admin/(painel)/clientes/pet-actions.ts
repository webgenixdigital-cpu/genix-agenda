"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getEditorContext } from "@/lib/admin";
import {
  PET_BEHAVIORS,
  PET_COAT_CONDITIONS,
  PET_COAT_TYPES,
  PET_NICHE_ID,
  PET_SEXES,
  PET_SIZES,
  PET_SPECIES,
  type PetInput,
} from "@/lib/pets";

type Result = { ok: true; id?: string } | { ok: false; error: string };

/** 63: só espaços do nicho "Banho e tosa" usam pets. Campos de saúde nunca são gravados (regra §4). */
function validate(input: PetInput) {
  if (input.name.trim().length < 1) return "Informe o nome do pet.";
  if (input.name.length > 60) return "Nome: no máximo 60 caracteres.";
  if (!PET_SPECIES.some((s) => s.value === input.species)) return "Espécie inválida.";
  if (input.sex && !PET_SEXES.some((s) => s.value === input.sex)) return "Sexo inválido.";
  if (input.size && !PET_SIZES.some((s) => s.value === input.size)) return "Porte inválido.";
  if (input.coatType && !PET_COAT_TYPES.includes(input.coatType)) return "Tipo de pelagem inválido.";
  if (input.coatCondition && !PET_COAT_CONDITIONS.includes(input.coatCondition)) return "Estado da pelagem inválido.";
  if (input.behavior.some((b) => !PET_BEHAVIORS.includes(b))) return "Comportamento inválido.";
  if (input.weightKg.trim()) {
    const w = Number(input.weightKg.replace(",", "."));
    if (!Number.isFinite(w) || w <= 0 || w > 150) return "Peso inválido (em kg, ex.: 8,5).";
  }
  if (input.birthDate && !/^\d{4}-\d{2}-\d{2}$/.test(input.birthDate)) return "Data de nascimento inválida.";
  if (input.fixedNotes.length > 500) return "Observações: no máximo 500 caracteres.";
  return null;
}

function columns(input: PetInput) {
  return {
    name: input.name.trim(),
    species: input.species,
    breed: input.breed.trim().slice(0, 60) || null,
    sex: input.sex || null,
    birth_date: input.birthDate || null,
    size: input.size || null,
    weight_kg: input.weightKg.trim() ? Number(input.weightKg.replace(",", ".")) : null,
    coat_type: input.coatType || null,
    coat_condition: input.coatCondition || null,
    neutered: input.neutered === "" ? null : input.neutered === "sim",
    behavior: input.behavior,
    fixed_notes: input.fixedNotes.trim() || null,
  };
}

// ---------------------------------------------------------------------
// PARTE 1 — Cadastrar e editar (matriz, recepção e profissional; o RLS confere)
// ---------------------------------------------------------------------
export async function savePet(customerId: string, petId: string | null, input: PetInput): Promise<Result> {
  const { business, role } = await getEditorContext();
  if (business.subcategory !== PET_NICHE_ID) return { ok: false, error: "Pets só estão disponíveis para banho e tosa." };
  if (role !== "owner" && role !== "reception" && role !== "staff") return { ok: false, error: "Sem permissão para editar pets." };
  const err = validate(input);
  if (err) return { ok: false, error: err };

  const supabase = createClient();
  const query = petId
    ? supabase.from("pets").update(columns(input)).eq("id", petId).eq("business_id", business.id).eq("customer_id", customerId)
    : supabase.from("pets").insert({ ...columns(input), business_id: business.id, customer_id: customerId });
  const { data, error } = await query.select("id").maybeSingle();

  if (error || !data) return { ok: false, error: "Não foi possível salvar o pet. Tente de novo." };
  revalidatePath(`/admin/clientes/${customerId}`);
  return { ok: true, id: data.id };
}

// ---------------------------------------------------------------------
// PARTE 2 — Arquivar (não apaga o histórico; qualquer editor) e excluir (só a matriz)
// ---------------------------------------------------------------------
export async function archivePet(customerId: string, petId: string): Promise<Result> {
  const { business } = await getEditorContext();
  const supabase = createClient();
  const { data, error } = await supabase
    .from("pets")
    .update({ active: false })
    .eq("id", petId)
    .eq("business_id", business.id)
    .eq("customer_id", customerId)
    .select("id")
    .maybeSingle();
  if (error || !data) return { ok: false, error: "Não foi possível arquivar o pet." };
  revalidatePath(`/admin/clientes/${customerId}`);
  return { ok: true };
}

export async function deletePet(customerId: string, petId: string): Promise<Result> {
  const { business, role } = await getEditorContext();
  if (role !== "owner") return { ok: false, error: "Só a matriz pode excluir um pet." };
  const supabase = createClient();
  const { error, count } = await supabase
    .from("pets")
    .delete({ count: "exact" })
    .eq("id", petId)
    .eq("business_id", business.id)
    .eq("customer_id", customerId);
  if (error || !count) return { ok: false, error: "Não foi possível excluir o pet." };
  revalidatePath(`/admin/clientes/${customerId}`);
  return { ok: true };
}

// ---------------------------------------------------------------------
// PARTE 3 — Endereço do tutor para o leva e traz (4a)
// ---------------------------------------------------------------------
export async function updateTutorAddress(
  customerId: string,
  input: { address: string; addressRef: string; altContact: string }
): Promise<Result> {
  const { business, role } = await getEditorContext();
  if (business.subcategory !== PET_NICHE_ID) return { ok: false, error: "Disponível só para banho e tosa." };
  if (role !== "owner" && role !== "reception" && role !== "staff") return { ok: false, error: "Sem permissão para editar o endereço." };
  if (input.address.length > 200 || input.addressRef.length > 120 || input.altContact.length > 120) {
    return { ok: false, error: "Texto muito longo." };
  }
  const supabase = createClient();
  const { data, error } = await supabase
    .from("customers")
    .update({
      address: input.address.trim() || null,
      address_ref: input.addressRef.trim() || null,
      alt_contact: input.altContact.trim() || null,
    })
    .eq("id", customerId)
    .eq("business_id", business.id)
    .select("id")
    .maybeSingle();
  if (error || !data) return { ok: false, error: "Não foi possível salvar o endereço." };
  revalidatePath(`/admin/clientes/${customerId}`);
  return { ok: true };
}
