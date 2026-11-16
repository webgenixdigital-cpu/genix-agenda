"use client";

// Diálogos das ações de um agendamento (Concluir, Editar, Remarcar, Cancelar, Reabrir).
//
// Por que ficam aqui, e não dentro do cartão: a lista do Dia é desenhada no servidor e,
// depois de salvar, é redesenhada. Quando um cartão sai da lista (remarcou para outro dia,
// cancelou, mudou de status com filtro) os cartões de baixo sobem, e o estado de um diálogo
// guardado no cartão ficava preso à POSIÇÃO: o diálogo aberto passava a mostrar (e a agir
// sobre) o agendamento que subiu para aquele lugar, ou fechava sozinho.
//
// Aqui o diálogo guarda uma CÓPIA do agendamento tirada no momento em que abre e mora fora
// das listas (layout da Agenda): a lista pode mudar à vontade que ele continua no mesmo
// agendamento e só fecha quando o usuário fecha.
import { createContext, useCallback, useContext, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCheck, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { cancelSeriesFuture, completeBooking, updateBookingStatus } from "@/app/admin/(painel)/agenda/actions";
import { Ajuda } from "@/components/ajuda";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { brl } from "@/lib/format";
import { RescheduleDialog } from "@/components/admin/agenda/reschedule-dialog";
import { EditBookingDialog, bookingTotals, itemGroups, useBookingEditInfo } from "@/components/admin/agenda/edit-booking-dialog";
import { ReopenDialog } from "@/components/admin/agenda/reopen-booking-button";
import { RegisterPaymentDialog } from "@/components/admin/register-payment-dialog";
import { todayISO } from "@/lib/dates";
import type { AgendaBooking, RescheduleProps } from "@/components/admin/agenda/booking-actions";

export type BookingDialogKind = "complete" | "edit" | "reschedule" | "cancel" | "cancel-series" | "reopen" | "payment";

/** O que o diálogo precisa além do agendamento (copiado na abertura) */
export type BookingDialogContext = {
  businessName: string;
  slug: string;
  fullAccess: boolean;
  reschedule?: RescheduleProps;
  /** cancelamento confirmado (true) ou desfeito por erro (false): quem lista esconde na hora */
  onCancelling?: (hidden: boolean) => void;
};

type Active = { kind: BookingDialogKind; booking: AgendaBooking; ctx: BookingDialogContext };

type Api = {
  openBooking: (kind: BookingDialogKind, booking: AgendaBooking, ctx: BookingDialogContext) => void;
  /** agendamentos escondidos na hora do cancelamento (até a lista nova chegar) */
  hiddenIds: ReadonlySet<string>;
};

const BookingDialogsCtx = createContext<Api | null>(null);

export function useBookingDialogs(): Api {
  const api = useContext(BookingDialogsCtx);
  if (!api) throw new Error("useBookingDialogs precisa do BookingDialogsProvider (layout da Agenda)");
  return api;
}

/** depois que um diálogo fecha, o mesmo toque não pode abrir outro (toque fantasma no cartão de baixo) */
const GHOST_MS = 400;

const METHODS = [
  { value: "pix", label: "Pix" },
  { value: "dinheiro", label: "Dinheiro" },
  { value: "credito", label: "Cartão de crédito" },
  { value: "debito", label: "Cartão de débito" },
] as const;

export function BookingDialogsProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [active, setActive] = useState<Active | null>(null);
  // `active` continua guardado depois de fechar (animação de saída sem o conteúdo sumir)
  const [open, setOpen] = useState(false);
  const closedAt = useRef(0);
  const [hiddenIds, setHiddenIds] = useState<ReadonlySet<string>>(() => new Set());
  const setHidden = useCallback((id: string, hidden: boolean) => {
    setHiddenIds((prev) => {
      const next = new Set(prev);
      if (hidden) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const openBooking = useCallback<Api["openBooking"]>((kind, booking, ctx) => {
    if (Date.now() - closedAt.current < GHOST_MS) return;
    setActive({ kind, booking: { ...booking }, ctx });
    setOpen(true);
  }, []);

  const close = useCallback(() => {
    closedAt.current = Date.now();
    setOpen(false);
  }, []);

  const is = (k: BookingDialogKind) => open && active?.kind === k;
  const onOpenChange = (o: boolean) => {
    if (!o) close();
  };

  return (
    <BookingDialogsCtx.Provider value={{ openBooking, hiddenIds }}>
      {children}

      {active && (
        <>
          <CompleteDialog key={`c-${active.booking.id}`} active={active} open={is("complete")} onClose={close} />

          <EditBookingDialog
            open={is("edit")}
            onOpenChange={onOpenChange}
            bookingId={active.booking.id}
            customerName={active.booking.customer_name}
          />

          {active.ctx.reschedule && (
            <RescheduleDialog
              key={`r-${active.booking.id}`}
              open={is("reschedule")}
              onOpenChange={onOpenChange}
              booking={active.booking}
              businessName={active.ctx.businessName}
              professionals={active.ctx.reschedule.professionals}
              canChooseProfessional={active.ctx.reschedule.canChooseProfessional}
              today={active.ctx.reschedule.today}
            />
          )}

          <CancelDialog
            active={active}
            open={is("cancel") || is("cancel-series")}
            onClose={close}
            onHide={setHidden}
            onDone={() => router.refresh()}
          />

          <ReopenDialog
            open={is("reopen")}
            onOpenChange={onOpenChange}
            bookingId={active.booking.id}
            customerName={active.booking.customer_name}
            packageSession={!!active.booking.customer_package_id}
          />

          {/* 49: atendimento concluído com "Escolher depois" */}
          <RegisterPaymentDialog
            open={is("payment")}
            onOpenChange={onOpenChange}
            today={active.ctx.reschedule?.today ?? todayISO()}
            target={{
              kind: "booking",
              id: active.booking.id,
              customerName: active.booking.customer_name,
              description: `${active.booking.service_name} · ${active.booking.booking_date.split("-").reverse().join("/")}`,
              suggested: null,
            }}
          />
        </>
      )}
    </BookingDialogsCtx.Provider>
  );
}

// ---------------------------------------------------------------------
// Concluir: resumo, "Adicionar serviço ou desconto" (Editar POR CIMA, sem fechar
// o Concluir) e forma de pagamento
// ---------------------------------------------------------------------
function CompleteDialog({ active, open, onClose }: { active: Active; open: boolean; onClose: () => void }) {
  const b = active.booking;
  const [pending, start] = useTransition();
  const [editOpen, setEditOpen] = useState(false);
  const summary = useBookingEditInfo(b.id, open);
  const totals = summary.info ? bookingTotals(summary.info) : null;
  // forma de pagamento só no plano pago e com valor a cobrar (sessão de pacote sem adicional: não)
  const askMethod = active.ctx.fullAccess && (totals?.charge ?? 0) > 0;

  useEffect(() => {
    if (!open) setEditOpen(false);
  }, [open]);

  function finish(method: (typeof METHODS)[number]["value"] | "pendente" | null, success: string) {
    onClose();
    start(async () => {
      const r = await completeBooking(b.id, method);
      if (!r) return; // demonstração: o servidor redirecionou
      if (r.ok) toast.success(success);
      else toast.error(r.error);
    });
  }

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="max-h-[92svh] max-w-sm overflow-y-auto rounded-2xl">
          <DialogHeader>
            <DialogTitle className="font-heading text-2xl">
              Concluir atendimento <Ajuda id="concluir" className="-ml-2" />
            </DialogTitle>
            <DialogDescription>
              {b.customer_name}
              {askMethod ? ". Como foi o pagamento?" : ""}
            </DialogDescription>
          </DialogHeader>

          {summary.error && <p className="rounded-xl bg-red-50 p-3 text-sm text-destructive">{summary.error}</p>}
          {!summary.info && !summary.error && (
            <p className="flex items-center justify-center gap-2 py-4 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
            </p>
          )}
          {summary.info && totals && (
            <div className="space-y-2 rounded-xl border p-3 text-sm" data-testid="resumo-concluir">
              <ul className="space-y-1">
                {itemGroups(summary.info.items).map((g) => (
                  <li key={g.key} className="flex justify-between gap-2">
                    <span className="min-w-0 truncate">{g.name}</span>
                    <span className="shrink-0 text-muted-foreground">{g.paid_by_package ? "pacote" : brl(g.price)}</span>
                  </li>
                ))}
                {totals.discount > 0 && (
                  <li className="flex justify-between gap-2 text-muted-foreground">
                    <span>Desconto</span>
                    <span>− {brl(totals.discount)}</span>
                  </li>
                )}
              </ul>
              <p className="flex justify-between border-t pt-2 text-base font-semibold">
                <span>{totals.byPackage > 0 ? "A cobrar" : "Total"}</span>
                <span>{brl(totals.charge)}</span>
              </p>
            </div>
          )}

          <Button
            variant="outline"
            className="h-11"
            disabled={pending || !summary.info}
            onClick={() => setEditOpen(true)}
            data-testid={`btn-concluir-editar-${b.id}`}
          >
            <Plus className="mr-1.5 h-4 w-4" /> Adicionar serviço ou desconto
          </Button>

          {!askMethod && (
            <Button
              className="h-12"
              disabled={pending || !summary.info}
              onClick={() =>
                finish(null, b.customer_package_id && !totals?.charge ? "Sessão do pacote concluída" : "Atendimento concluído")
              }
              data-testid={`btn-concluir-confirmar-${b.id}`}
            >
              <CheckCheck className="mr-1.5 h-4 w-4" /> Concluir
            </Button>
          )}

          {askMethod && (
            <div className="grid grid-cols-2 gap-2">
              {METHODS.map((m) => (
                <Button
                  key={m.value}
                  variant="outline"
                  className="h-12"
                  disabled={pending}
                  onClick={() => finish(m.value, `Concluído e lançado no caixa (${m.label})`)}
                  data-testid={`pagamento-${m.value}`}
                >
                  {m.label}
                </Button>
              ))}
            </div>
          )}
          {askMethod && (
            <div className="space-y-1">
              <div className="flex items-center gap-1">
                <Button
                  variant="secondary"
                  className="h-12 flex-1"
                  disabled={pending}
                  onClick={() => finish("pendente", "Concluído · Pagamento pendente")}
                  data-testid={`btn-concluir-depois-${b.id}`}
                >
                  Escolher depois
                </Button>
                <Ajuda id="pagamento-pendente" />
              </div>
              <p className="text-xs text-muted-foreground">
                O atendimento fica concluído, com <strong>Pagamento pendente</strong>, até você registrar o pagamento.
              </p>
            </div>
          )}
          {askMethod && (
            <div className="space-y-1">
              <Button
                variant="ghost"
                className="h-11 w-full"
                disabled={pending}
                onClick={() => finish(null, "Atendimento concluído")}
                data-testid={`btn-concluir-sem-caixa-${b.id}`}
              >
                Concluir sem lançar no caixa
              </Button>
              <p className="text-center text-xs text-muted-foreground">Não fica pendente: nada vai para o caixa.</p>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Editar por cima do Concluir: ao fechar, o Concluir continua aberto e recarrega o resumo */}
      <EditBookingDialog
        open={open && editOpen}
        onOpenChange={(o) => {
          if (o) return;
          setEditOpen(false);
          void summary.reload();
        }}
        bookingId={b.id}
        customerName={b.customer_name}
      />
    </>
  );
}

// ---------------------------------------------------------------------
// Cancelar (um horário ou as próximas da série)
// ---------------------------------------------------------------------
function CancelDialog({
  active,
  open,
  onClose,
  onHide,
  onDone,
}: {
  active: Active;
  open: boolean;
  onClose: () => void;
  onHide: (id: string, hidden: boolean) => void;
  onDone: () => void;
}) {
  const b = active.booking;
  const series = active.kind === "cancel-series";
  const [pending, start] = useTransition();

  // some da lista assim que confirma (sem esperar o servidor); volta se der erro.
  // Pelo id do agendamento (estado do React), nunca mexendo no elemento da lista.
  function hide(hidden: boolean) {
    onHide(b.id, hidden);
    active.ctx.onCancelling?.(hidden);
  }

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={series ? "Cancelar as próximas?" : "Cancelar o horário?"}
      description={
        <>
          <p>
            {series
              ? `Este e os próximos horários desta série de ${b.customer_name} serão cancelados. Os que já passaram não mudam.`
              : `O horário de ${b.customer_name} sai da agenda e continua no histórico do cliente.`}
          </p>
          {b.customer_package_id && (
            <p>{series ? "As sessões voltam para o saldo do pacote." : "A sessão volta para o saldo do pacote."}</p>
          )}
        </>
      }
      confirmLabel={series ? "Cancelar as próximas" : "Cancelar horário"}
      destructive
      pending={pending}
      testId={`cancelar-${b.id}`}
      onConfirm={() => {
        onClose();
        hide(true);
        start(async () => {
          if (series) {
            const r = await cancelSeriesFuture(b.series_id!);
            if (!r) return; // demonstração: o servidor redirecionou
            if (!r.ok) {
              hide(false);
              return void toast.error(r.error);
            }
            toast.success(
              r.cancelled === 0
                ? "Nenhum horário futuro desta série para cancelar"
                : `${r.cancelled} ${r.cancelled === 1 ? "horário cancelado" : "horários cancelados"}`
            );
          } else {
            const r = await updateBookingStatus(b.id, "cancelled");
            if (!r) return; // demonstração: o servidor redirecionou
            if (!r.ok) {
              hide(false);
              return void toast.error(r.error);
            }
            toast.success("Agendamento cancelado");
          }
          // a action já revalida a Agenda; o refresh garante a lista nova no calendário aberto
          onDone();
        });
      }}
    />
  );
}
