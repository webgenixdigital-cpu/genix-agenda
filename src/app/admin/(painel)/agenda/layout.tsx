import { BookingDialogsProvider } from "@/components/admin/agenda/booking-dialogs";

// Diálogos das ações do agendamento ficam aqui, fora das listas: o layout não é remontado
// quando a página (lista do dia, semana, mês) é redesenhada depois de salvar.
export default function AgendaLayout({ children }: { children: React.ReactNode }) {
  return <BookingDialogsProvider>{children}</BookingDialogsProvider>;
}
