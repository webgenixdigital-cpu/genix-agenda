// Textos do lembrete automático (usado no servidor e no navegador)
import { brl, longDate } from "@/lib/format";

/** Variáveis aceitas nos textos A, B e C */
export const TEMPLATE_VARS = [
  { key: "primeiro_nome", label: "primeiro nome" },
  { key: "servico", label: "serviço" },
  { key: "profissional", label: "profissional" },
  { key: "data", label: "data" },
  { key: "hora", label: "hora" },
  { key: "espaco", label: "nome do espaço" },
] as const;

/** Fila manual de Lembretes: as mesmas variáveis + {total} (o automático não usa) */
export const MANUAL_TEMPLATE_VARS = [...TEMPLATE_VARS, { key: "total", label: "valor total" }] as const;

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

// Igual ao default de whatsapp_settings.template_c (migration 34): mudar nos dois lugares.
export const DEFAULT_TEMPLATE_C =
  "{primeiro_nome}, seu horário está chegando ✨\n\n" +
  "• {data}, às {hora}\n• {servico} com {profissional}\n\n" +
  "Estamos te esperando! Se precisar remarcar ou surgir algum imprevisto, é só responder esta mensagem.\n{espaco}";

/** Textos padrão na ordem do rodízio (variant 0, 1, 2) */
export const DEFAULT_TEMPLATES = [DEFAULT_TEMPLATE_A, DEFAULT_TEMPLATE_B, DEFAULT_TEMPLATE_C] as const;

// ---------------------------------------------------------------------
// Tipos de mensagem automática (42_whatsapp_tipos_mensagem)
// ---------------------------------------------------------------------
export type MessageKind = "confirmation" | "before" | "eve" | "birthday";

export const MESSAGE_KINDS: readonly MessageKind[] = ["confirmation", "before", "eve", "birthday"];

export const KIND_LABEL: Record<MessageKind, string> = {
  confirmation: "Confirmação",
  before: "Antes do horário",
  eve: "Véspera",
  birthday: "Aniversário",
};

export const DEFAULT_TEMPLATE_CONFIRM =
  "Olá, {primeiro_nome}! Seu horário está confirmado ✅\n\n" +
  "• {servico}\n• Com {profissional}\n• {data}, às {hora}\n\n" +
  "Se precisar remarcar, é só responder esta mensagem.\n{espaco}";

export const DEFAULT_TEMPLATE_BEFORE =
  "{primeiro_nome}, seu horário é daqui a pouco ⏰\n\n" +
  "• {servico} com {profissional}\n• Hoje, às {hora}\n\n" +
  "Estamos te esperando! Se tiver algum imprevisto, responda esta mensagem.\n{espaco}";

export const DEFAULT_TEMPLATE_BIRTHDAY =
  "Feliz aniversário, {primeiro_nome}! 🎉\n\n" +
  "Toda a equipe deseja um dia lindo e um novo ano cheio de coisas boas. Obrigado por estar com a gente 💛\n{espaco}";

/** Texto padrão de cada tipo (véspera: pelo rodízio A/B/C) */
export function defaultTemplateFor(kind: MessageKind, variant = 0): string {
  if (kind === "confirmation") return DEFAULT_TEMPLATE_CONFIRM;
  if (kind === "before") return DEFAULT_TEMPLATE_BEFORE;
  if (kind === "birthday") return DEFAULT_TEMPLATE_BIRTHDAY;
  return DEFAULT_TEMPLATES[variant] ?? DEFAULT_TEMPLATES[0];
}

/** Aniversário não tem agendamento: só nome e espaço */
export const BIRTHDAY_VARS = TEMPLATE_VARS.filter((v) => v.key === "primeiro_nome" || v.key === "espaco");

/** Antecedência do "antes do horário" (minutos) */
export const BEFORE_OPTIONS = [
  { minutes: 60, label: "1h antes" },
  { minutes: 90, label: "1h30 antes" },
  { minutes: 120, label: "2h antes" },
] as const;

export type TemplateData = {
  customerName: string;
  serviceName: string;
  professionalName: string;
  /** "yyyy-mm-dd" */
  date: string;
  /** "HH:MM" ou "HH:MM:SS" */
  time: string;
  businessName: string;
  /** só na fila manual: valor total do agendamento; sem valor (null/0) = {total} vazio */
  total?: number | null;
};

export function renderTemplate(text: string, d: TemplateData) {
  const vars: Record<string, string> = {
    primeiro_nome: d.customerName.trim().split(" ")[0] ?? "",
    servico: d.serviceName,
    profissional: d.professionalName,
    // aniversário: sem agendamento, data e hora vêm vazias
    data: d.date ? longDate(d.date) : "",
    hora: (d.time ?? "").slice(0, 5),
    espaco: d.businessName,
  };
  // undefined = texto do automático, que não tem {total} (fica como está)
  if (d.total !== undefined) vars.total = d.total && Number(d.total) > 0 ? brl(Number(d.total)) : "";
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
  // fila (42)
  EXPIRADA: "fora da validade (o limite de envios do número estava ocupado)",
  DISPENSADA: "outra mensagem deste horário saiu há pouco",
  CANCELADO: "agendamento cancelado",
  REMARCADO: "agendamento remarcado",
  NAO_CONFIRMADO: "agendamento deixou de estar confirmado",
  JA_LEMBRADO: "lembrete já enviado pela fila manual",
  OPT_OUT: "cliente não recebe mensagens automáticas",
  DESLIGADO: "tipo de mensagem desligado",
};

export const reasonLabel = (r: string | null | undefined) => (r && REASON_LABEL[r]) || "erro no envio";
