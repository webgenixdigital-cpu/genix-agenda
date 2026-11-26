/** 63 — Módulo pet (nicho "Banho e tosa"). Arquivo leve: pode ir para qualquer tela. */

export const PET_NICHE_ID = "pet";

export const PET_SPECIES = [
  { value: "cao", label: "Cão" },
  { value: "gato", label: "Gato" },
  { value: "outro", label: "Outro" },
] as const;

export const PET_SEXES = [
  { value: "macho", label: "Macho" },
  { value: "femea", label: "Fêmea" },
] as const;

/** 71: faixas iguais a pet_size_from_weight no banco (max = limite superior em kg) */
export const PET_SIZES = [
  { value: "mini", label: "Mini (até 4 kg)", max: 4 },
  { value: "pequeno", label: "Pequeno (4,1 a 9 kg)", max: 9 },
  { value: "medio", label: "Médio (9,1 a 16 kg)", max: 16 },
  { value: "grande", label: "Grande (16,1 a 25 kg)", max: 25 },
  { value: "gigante", label: "Gigante (mais de 25 kg)", max: Infinity },
] as const;

/** 71: porte pelo peso ("8,5" ou 8.5). Vazio/inválido = "" */
export function petSizeFromWeight(weight: string | number | null | undefined): string {
  const w = typeof weight === "number" ? weight : Number(String(weight ?? "").replace(",", "."));
  if (!Number.isFinite(w) || w <= 0) return "";
  return PET_SIZES.find((s) => w <= s.max)?.value ?? "";
}

export const PET_COAT_TYPES = ["Curta", "Média", "Longa", "Dupla", "Crespa/encaracolada", "Dura (stripping)", "Sem pelo"];
export const PET_COAT_CONDITIONS = ["Normal", "Com nós", "Embolada"];
export const PET_BEHAVIORS = ["Dócil", "Agitado", "Medroso", "Morde", "Medo de secador", "Usa focinheira", "Não gosta de outros pets"];

export type PetInput = {
  name: string;
  species: string;
  breed: string;
  sex: string;
  birthDate: string;
  size: string;
  weightKg: string;
  coatType: string;
  coatCondition: string;
  /** "sim" | "nao" | "" (não informado) */
  neutered: string;
  behavior: string[];
  fixedNotes: string;
};

/** Linha de pets lida na ficha do cliente. Sem as colunas de saúde (fora da interface nesta fase). */
export type Pet = {
  id: string;
  name: string;
  species: string;
  breed: string | null;
  sex: string | null;
  birth_date: string | null;
  size: string | null;
  weight_kg: number | null;
  coat_type: string | null;
  coat_condition: string | null;
  neutered: boolean | null;
  behavior: string[];
  fixed_notes: string | null;
  active: boolean;
};

export const PET_COLUMNS =
  "id, name, species, breed, sex, birth_date, size, weight_kg, coat_type, coat_condition, neutered, behavior, fixed_notes, active";

export const labelOf = (list: readonly { value: string; label: string }[], v: string | null) =>
  list.find((i) => i.value === v)?.label ?? "";

/** 64: no banho e tosa quem é atendido é o pet; o tutor aparece junto para identificar */
export type WithPet = { customer_name: string; pet_name?: string | null };
/** Nome em destaque: o pet (se houver) ou o cliente */
export const attendeeName = (b: WithPet) => b.pet_name || b.customer_name;
/** Linha de apoio: "Tutor: Fulano" quando o destaque é o pet */
export const tutorLine = (b: WithPet) => (b.pet_name ? `Tutor: ${b.customer_name}` : null);
/** Texto corrido: "Thor (tutor Fulano)" ou só o cliente */
export const attendeeText = (b: WithPet) => (b.pet_name ? `${b.pet_name} (tutor ${b.customer_name})` : b.customer_name);

/** 4a: leva e traz */
export const TRANSPORT_LABEL: Record<"nenhum" | "busca" | "entrega" | "busca_entrega", string> = {
  nenhum: "Sem leva e traz",
  busca: "Busca",
  entrega: "Entrega",
  busca_entrega: "Busca e entrega",
};

/** 4b: status de cada parada (igual ao check de transport_routes.status na 63) */
export const ROUTE_STATUSES = ["aguardando", "a_caminho", "coletado", "na_loja", "saiu_entrega", "entregue", "cancelado"] as const;
export type RouteStatus = (typeof ROUTE_STATUSES)[number];
export const ROUTE_STATUS_LABEL: Record<RouteStatus, string> = {
  aguardando: "Aguardando",
  a_caminho: "A caminho",
  coletado: "Pet coletado",
  na_loja: "Na loja",
  saiu_entrega: "Saiu para entrega",
  entregue: "Entregue",
  cancelado: "Cancelado",
};
/** Status que fazem sentido em cada tipo de parada (na ordem do dia) */
export const ROUTE_FLOW: Record<"busca" | "entrega", RouteStatus[]> = {
  busca: ["aguardando", "a_caminho", "coletado", "na_loja", "cancelado"],
  entrega: ["aguardando", "saiu_entrega", "entregue", "cancelado"],
};
