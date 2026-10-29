// Textos do lembrete automático (usado no servidor e no navegador)
import { longDate } from "@/lib/format";

/** Variáveis aceitas nos textos A e B */
export const TEMPLATE_VARS = [
  { key: "primeiro_nome", label: "primeiro nome" },
  { key: "servico", label: "serviço" },
  { key: "profissional", label: "profissional" },
  { key: "data", label: "data" },
  { key: "hora", label: "hora" },
  { key: "espaco", label: "nome do espaço" },
] as const;

// Base no lembrete manual (lib/messages.ts → reminderMessage), sem "amanhã"
// fixo: o mesmo texto serve para o envio da véspera e do próprio dia.
export const DEFAULT_TEMPLATE_A =
  "Olá, {primeiro_nome}! Passando para lembrar do seu horário ⏰\n\n" +
  "• {servico}\n• Com {profissional}\n• {data}, às {hora}\n\n" +
  "Pode confirmar sua presença respondendo esta mensagem? Se precisar remarcar, é só avisar.\n{espaco}";

export const DEFAULT_TEMPLATE_B =
  "Oi, {primeiro_nome}, tudo bem? 💛\n\n" +
  "Seu horário de {servico} com {profissional} está marcado para {data}, às {hora}.\n\n" +
  "Responda esta mensagem para confirmar. Se surgir algum imprevisto, é só avisar que a gente remarca.\n{espaco}";

export const DEFAULT_TEMPLATES = [DEFAULT_TEMPLATE_A, DEFAULT_TEMPLATE_B] as const;

export type TemplateData = {
  customerName: string;
  serviceName: string;
  professionalName: string;
  /** "yyyy-mm-dd" */
  date: string;
  /** "HH:MM" ou "HH:MM:SS" */
  time: string;
  businessName: string;
};

export function renderTemplate(text: string, d: TemplateData) {
  const vars: Record<string, string> = {
    primeiro_nome: d.customerName.trim().split(" ")[0] ?? "",
    servico: d.serviceName,
    profissional: d.professionalName,
    data: longDate(d.date),
    hora: d.time.slice(0, 5),
    espaco: d.businessName,
  };
  return text.replace(/\{(\w+)\}/g, (all, key: string) => (key in vars ? vars[key] : all));
}

/** Motivos gravados em whatsapp_reminder_sends.reason → texto para a tela */
const REASON_LABEL: Record<string, string> = {
  TIMEOUT: "o WhatsApp demorou para responder",
  REDE: "falha de conexão com o WhatsApp",
  ERRO_PROVEDOR: "instabilidade no serviço de WhatsApp",
  DESCONECTADO: "WhatsApp do espaço desconectado",
  NUMERO_INVALIDO: "número sem WhatsApp ou inválido",
  RECUSADO: "envio recusado pelo serviço de WhatsApp",
  INTERROMPIDO: "envio interrompido",
  AGENDAMENTO_MUDOU: "o agendamento mudou durante o envio",
};

export const reasonLabel = (r: string | null | undefined) => (r && REASON_LABEL[r]) || "erro no envio";
