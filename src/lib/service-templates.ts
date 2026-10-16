// Serviços sugeridos por segmento (preços de referência para o profissional ajustar)
import type { Segment } from "@/lib/types";

export type ServiceTemplate = { name: string; category: string; duration_min: number; price: number; description: string };

export const SERVICE_TEMPLATES: Record<Segment, ServiceTemplate[]> = {
  beleza: [
    { name: "Corte feminino", category: "Cabelo", duration_min: 60, price: 80, description: "Corte com lavagem e finalização." },
    { name: "Corte masculino", category: "Cabelo", duration_min: 30, price: 45, description: "Corte na tesoura ou máquina." },
    { name: "Escova", category: "Cabelo", duration_min: 45, price: 50, description: "Escova modelada com finalização." },
    { name: "Coloração", category: "Coloração", duration_min: 120, price: 150, description: "Coloração completa com produtos profissionais." },
    { name: "Manicure", category: "Unhas", duration_min: 45, price: 35, description: "Cutilagem e esmaltação." },
    { name: "Pedicure", category: "Unhas", duration_min: 50, price: 40, description: "Cuidado completo dos pés com esmaltação." },
  ],
  estetica: [
    { name: "Limpeza de pele", category: "Facial", duration_min: 90, price: 150, description: "Higienização, extração e máscara calmante." },
    { name: "Peeling", category: "Facial", duration_min: 60, price: 180, description: "Renovação e uniformização da pele." },
    { name: "Drenagem linfática", category: "Corporal", duration_min: 60, price: 120, description: "Redução de inchaço e sensação de leveza." },
    { name: "Massagem relaxante", category: "Corporal", duration_min: 60, price: 120, description: "Alívio de tensões e bem-estar." },
    { name: "Design de sobrancelhas", category: "Sobrancelhas", duration_min: 40, price: 50, description: "Design personalizado." },
  ],
  psicologia_terapias: [
    { name: "Primeira conversa", category: "Atendimentos", duration_min: 50, price: 150, description: "Encontro inicial para entender sua necessidade." },
    { name: "Sessão individual", category: "Atendimentos", duration_min: 50, price: 150, description: "Sessão presencial." },
    { name: "Sessão online", category: "Atendimentos", duration_min: 50, price: 150, description: "Sessão por videochamada." },
    { name: "Sessão de casal", category: "Atendimentos", duration_min: 80, price: 220, description: "Atendimento para casais." },
  ],
  outros: [
    { name: "Avaliação inicial", category: "Atendimentos", duration_min: 30, price: 50, description: "Primeiro contato para entender o que você precisa." },
    { name: "Atendimento", category: "Atendimentos", duration_min: 60, price: 100, description: "Atendimento padrão." },
  ],
};
