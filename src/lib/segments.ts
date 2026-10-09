import type { Segment } from "./types";

export const SEGMENTS: { value: Segment; label: string }[] = [
  { value: "beleza", label: "Beleza" },
  { value: "estetica", label: "Estética" },
  { value: "psicologia_terapias", label: "Psicologia e terapias" },
  { value: "outros", label: "Outros profissionais" },
];

export const SUBCATEGORY_LABELS: Record<string, string> = {
  salao: "Salão de beleza",
  barbearia: "Barbearia",
  "clinica-estetica": "Clínica de estética",
  estetica: "Estética",
  designer: "Design de sobrancelhas",
  sobrancelhas: "Sobrancelhas",
  lash: "Lash designer",
  unhas: "Unhas",
  spa: "Spa",
  tattoo: "Tatuagem",
  psicologia: "Psicologia",
  terapeuta: "Terapias",
  nutricionista: "Nutrição",
  personal: "Personal trainer",
  fisioterapia: "Fisioterapia",
};

export const segmentLabel = (s: string) => SEGMENTS.find((x) => x.value === s)?.label ?? s;
export const subcategoryLabel = (s: string | null) => (s ? SUBCATEGORY_LABELS[s] ?? s : "");