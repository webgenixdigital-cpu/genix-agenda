import type { Segment } from "./types";

// Segmentos OFERECIDOS hoje (cadastro, filtros e configurações).
// "psicologia_terapias" continua existindo no banco, mas não é oferecido:
// profissionais da saúde ficam para um projeto futuro.
export const SEGMENTS: { value: Segment; label: string }[] = [
  { value: "beleza", label: "Beleza" },
  { value: "estetica", label: "Estética" },
  { value: "outros", label: "Outros profissionais" },
];

// Rótulos de TODOS os segmentos (inclusive os não oferecidos), para exibir contas antigas
const ALL_SEGMENT_LABELS: Record<Segment, string> = {
  beleza: "Beleza",
  estetica: "Estética",
  psicologia_terapias: "Psicologia e terapias",
  outros: "Outros profissionais",
};

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
  personal: "Personal trainer",
};

export const segmentLabel = (s: string) => ALL_SEGMENT_LABELS[s as Segment] ?? s;
export const subcategoryLabel = (s: string | null) => (s ? SUBCATEGORY_LABELS[s] ?? s : "");
