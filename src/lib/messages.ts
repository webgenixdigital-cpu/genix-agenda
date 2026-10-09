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

export function customerMessage(b: B, businessName: string) {
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
      return `Olá, ${first}! Obrigado pela visita hoje 💛 Se puder, conta pra gente como foi.\n${businessName}`;
    case "cancelled":
      return (
        `Olá, ${first}. Seu horário de ${b.service_name} em ${when} foi cancelado.\n` +
        `Quer escolher uma nova data? É só responder aqui.\n${businessName}`
      );
  }
}