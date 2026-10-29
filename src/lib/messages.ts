// Mensagens prontas de WhatsApp do estabelecimento para o cliente
import { longDate } from "./format";
import type { BookingStatus } from "./types";

type B = {
  customer_name: string;
  service_name: string;
  professional_name: string;
  booking_date: string;
  start_time: string;
  status: BookingStatus;
};

/** reviewUrl: link de avaliação, usado na mensagem de atendimento concluído */
export function customerMessage(b: B, businessName: string, reviewUrl?: string) {
  const first = b.customer_name.split(" ")[0];
  const when = `${longDate(b.booking_date)}, às ${b.start_time.slice(0, 5)}`;

  switch (b.status) {
    case "pending":
    case "confirmed":
      return (
        `Olá, ${first}! Seu horário está confirmado ✅\n\n` +
        `• ${b.service_name}\n• Com ${b.professional_name}\n• ${when}\n\n` +
        `Se precisar remarcar, é só responder esta mensagem.\n${businessName}`
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
  isToday: boolean
) {
  const first = name.split(" ")[0];
  return (
    `Olá, ${first}! Passando para lembrar do seu horário ${isToday ? "hoje" : "amanhã"} ⏰\n\n` +
    `• ${service}\n• Com ${pro}\n• ${longDate(date)}, às ${time.slice(0, 5)}\n\n` +
    `Pode confirmar sua presença respondendo esta mensagem? Se precisar remarcar, é só avisar.\n${business}`
  );
}

/** Aviso de remarcação com a nova data, hora e profissional */
export function rescheduleMessage(
  b: { customer_name: string; service_name: string; professional_name: string; booking_date: string; start_time: string },
  businessName: string
) {
  const first = b.customer_name.split(" ")[0];
  return (
    `Olá, ${first}! Seu horário foi remarcado ✅\n\n` +
    `• ${b.service_name}\n• Com ${b.professional_name}\n• ${longDate(b.booking_date)}, às ${b.start_time.slice(0, 5)}\n\n` +
    `Se esse horário não for bom, é só responder esta mensagem.\n${businessName}`
  );
}
