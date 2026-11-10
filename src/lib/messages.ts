// Mensagens prontas de WhatsApp do estabelecimento para o cliente
import { brl, longDate } from "./format";
import { renderTemplate } from "./whatsapp/templates";
import type { BookingStatus } from "./types";

type B = {
  customer_name: string;
  service_name: string;
  professional_name: string;
  booking_date: string;
  start_time: string;
  status: BookingStatus;
  /** total final e quantidade de serviços: com mais de 1, a mensagem mostra o total */
  price?: number;
  items_count?: number;
};

/** Linha do total, só quando o agendamento tem mais de um serviço */
function totalLine(itemsCount?: number, total?: number) {
  return (itemsCount ?? 1) > 1 && total !== undefined ? `• Total: ${brl(Number(total))}\n` : "";
}

/** reviewUrl: link de avaliação, usado na mensagem de atendimento concluído */
export function customerMessage(b: B, businessName: string, reviewUrl?: string) {
  const first = b.customer_name.split(" ")[0];
  const when = `${longDate(b.booking_date)}, às ${b.start_time.slice(0, 5)}`;

  switch (b.status) {
    case "pending":
    case "confirmed":
      return (
        `Olá, ${first}! Seu horário está confirmado ✅\n\n` +
        `• ${b.service_name}\n• Com ${b.professional_name}\n• ${when}\n` +
        totalLine(b.items_count, b.price) +
        `\nSe precisar remarcar, é só responder esta mensagem.\n${businessName}`
      );
    case "completed":
      return (
        `Olá, ${first}! Obrigado pela visita hoje 💛\n\n` +
        (reviewUrl
          ? `Pode avaliar seu atendimento? Leva 10 segundos:\n${reviewUrl}\n\n`
          : `Se puder, conta pra gente como foi.\n\n`) +
        businessName
      );
    case "cancelled":
      return (
        `Olá, ${first}. Seu horário de ${b.service_name} em ${when} foi cancelado.\n` +
        `Quer escolher uma nova data? É só responder aqui.\n${businessName}`
      );
  }
}
/** Convite de retorno ("hora de voltar"), com link da vitrine para reagendar */
export function returnMessage(name: string, service: string, lastDate: string, businessName: string, bookingUrl: string) {
  const first = name.split(" ")[0];
  return (
    `Olá, ${first}! Tudo bem? 💛\n\n` +
    `Seu último ${service} foi em ${longDate(lastDate)} e já está na hora de renovar.\n\n` +
    `Escolha o melhor horário por aqui:\n${bookingUrl}\n\n` +
    `Ou responda esta mensagem que a gente agenda pra você.\n${businessName}`
  );
}

/** Lembrete manual de véspera/do dia (base dos textos automáticos em lib/whatsapp/templates.ts) */
export function reminderMessage(
  name: string,
  service: string,
  pro: string,
  date: string,
  time: string,
  business: string,
  isToday: boolean,
  /** agendamento com mais de um serviço: mostra o total */
  total?: { itemsCount: number; price: number }
) {
  const first = name.split(" ")[0];
  return (
    `Olá, ${first}! Passando para lembrar do seu horário ${isToday ? "hoje" : "amanhã"} ⏰\n\n` +
    `• ${service}\n• Com ${pro}\n• ${longDate(date)}, às ${time.slice(0, 5)}\n` +
    totalLine(total?.itemsCount, total?.price) +
    `\nPode confirmar sua presença respondendo esta mensagem? Se precisar remarcar, é só avisar.\n${business}`
  );
}

// ---------------------------------------------------------------------
// Fila manual com texto do espaço (41_nascimento_texto_lembrete)
// Os padrões repetem o reminderMessage acima com variáveis. Sem texto salvo,
// a fila continua usando reminderMessage (que põe a linha "Total" sozinha
// quando o agendamento tem mais de um serviço).
// ---------------------------------------------------------------------
const manualDefault = (when: "amanhã" | "hoje") =>
  `Olá, {primeiro_nome}! Passando para lembrar do seu horário ${when} ⏰\n\n` +
  "• {servico}\n• Com {profissional}\n• {data}, às {hora}\n\n" +
  "Pode confirmar sua presença respondendo esta mensagem? Se precisar remarcar, é só avisar.\n{espaco}";

export const DEFAULT_MANUAL_TOMORROW = manualDefault("amanhã");
export const DEFAULT_MANUAL_TODAY = manualDefault("hoje");

/** Mensagem do botão da fila: texto salvo (com variáveis) ou o padrão de sempre */
export function manualReminderText(
  saved: string | null | undefined,
  isToday: boolean,
  d: { name: string; service: string; pro: string; date: string; time: string; business: string; itemsCount: number; price: number | null }
) {
  if (!saved?.trim()) {
    return reminderMessage(d.name, d.service, d.pro, d.date, d.time, d.business, isToday, {
      itemsCount: d.itemsCount,
      price: Number(d.price ?? 0),
    });
  }
  return renderTemplate(saved, {
    customerName: d.name,
    serviceName: d.service,
    professionalName: d.pro,
    date: d.date,
    time: d.time,
    businessName: d.business,
    total: d.price ?? null,
  });
}

/** Aviso de remarcação com a nova data, hora e profissional */
export function rescheduleMessage(
  b: {
    customer_name: string;
    service_name: string;
    professional_name: string;
    booking_date: string;
    start_time: string;
    price?: number;
    items_count?: number;
  },
  businessName: string
) {
  const first = b.customer_name.split(" ")[0];
  return (
    `Olá, ${first}! Seu horário foi remarcado ✅\n\n` +
    `• ${b.service_name}\n• Com ${b.professional_name}\n• ${longDate(b.booking_date)}, às ${b.start_time.slice(0, 5)}\n` +
    totalLine(b.items_count, b.price) +
    `\nSe esse horário não for bom, é só responder esta mensagem.\n${businessName}`
  );
}
