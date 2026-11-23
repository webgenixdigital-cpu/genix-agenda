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

export const PET_SIZES = [
  { value: "mini", label: "Mini (até 3 kg)" },
  { value: "pequeno", label: "Pequeno (3 a 10 kg)" },
  { value: "medio", label: "Médio (10 a 25 kg)" },
  { value: "grande", label: "Grande (25 a 45 kg)" },
  { value: "gigante", label: "Gigante (mais de 45 kg)" },
] as const;

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
