import { headers } from "next/headers";
import { CheckCircle2 } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { longDate, maskPhone, whatsappLink } from "@/lib/format";
import { returnMessage } from "@/lib/messages";
import { SendReturnButton, UndoReturnButton } from "@/components/admin/lembretes/return-actions";
import { cn } from "@/lib/utils";

type Item = {
  booking_id: string;
  customer_name: string;
  customer_phone: string;
  service_name: string;
  professional_name: string;
  last_date: string;
  due_date: string;
  days_overdue: number;
  return_contacted_at: string | null;
};

function siteOrigin() {
  const h = headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "genixagenda.com.br";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

function dueLabel(days: number) {
  if (days === 0) return "Vence hoje";
  if (days > 0) return days === 1 ? "Venceu há 1 dia" : `Venceu há ${days} dias`;
  return -days === 1 ? "Vence amanhã" : `Vence em ${-days} dias`;
}

/** Fila "Hora de voltar": clientes cujo prazo de retorno do serviço venceu ou vence em 7 dias */
export async function ReturnQueue({ business }: { business: { id: string; name: string; slug: string } }) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("return_queue", { p_business: business.id });
  const items = (data ?? []) as Item[];

  const bookingUrl = `${siteOrigin()}/v/${business.slug}`;
  const queue = items.filter((i) => !i.return_contacted_at);
  const overdue = queue.filter((i) => i.days_overdue >= 0);
  const upcoming = queue.filter((i) => i.days_overdue < 0);
  const contacted = items.filter((i) => i.return_contacted_at);

  if (error) {
    return <p className="rounded-lg bg-red-50 p-3 text-sm text-destructive">Não foi possível carregar os retornos.</p>;
  }

  const group = (title: string, list: Item[]) =>
    list.length > 0 && (
      <section className="space-y-3">
        <h2 className="font-sans text-sm font-semibold text-muted-foreground">
          {title} ({list.length})
        </h2>
        <ul className="space-y-3">
          {list.map((i) => {
            const href = whatsappLink(
              i.customer_phone,
              returnMessage(i.customer_name, i.service_name, i.last_date, business.name, bookingUrl)
            );
            return (
              <li
                key={i.booking_id}
                className="flex flex-col gap-3 rounded-2xl border bg-card p-4 sm:flex-row sm:items-center"
                data-testid={`retorno-${i.booking_id}`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold">{i.customer_name}</p>
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-xs font-medium",
                        i.days_overdue >= 0 ? "bg-amber-100 text-amber-800" : "bg-stone-100 text-stone-700"
                      )}
                    >
                      {dueLabel(i.days_overdue)}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {i.service_name} com {i.professional_name} · última vez em {longDate(i.last_date)}
                  </p>
                  <p className="text-sm text-muted-foreground">{maskPhone(i.customer_phone)}</p>
                </div>
                {href && <SendReturnButton id={i.booking_id} href={href} />}
              </li>
            );
          })}
        </ul>
      </section>
    );

  return (
    <>
      <p className="text-sm font-semibold">
        {queue.length} na fila, {contacted.length} {contacted.length === 1 ? "chamado" : "chamados"}
      </p>

      {queue.length === 0 ? (
        <div className="rounded-2xl border border-dashed bg-white p-10 text-center">
          <CheckCircle2 className="mx-auto h-10 w-10 text-green-600" />
          <p className="mt-3 font-heading text-2xl">
            {items.length === 0 ? "Nenhum retorno pendente" : "Todos os clientes foram chamados"}
          </p>
          {items.length === 0 && (
            <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
              Defina o “Retorno sugerido” nos serviços para os clientes aparecerem aqui quando chegar a hora de voltar.
            </p>
          )}
        </div>
      ) : (
        <>
          {group("Hora de voltar", overdue)}
          {group("Nos próximos 7 dias", upcoming)}
        </>
      )}

      {contacted.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-sans text-sm font-semibold text-muted-foreground">Já chamados</h2>
          <ul className="divide-y rounded-2xl border bg-card">
            {contacted.map((i) => (
              <li key={i.booking_id} className="flex items-center gap-3 p-4">
                <CheckCircle2 className="h-5 w-5 shrink-0 text-green-600" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">
                    {i.customer_name} · {i.service_name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Chamado em{" "}
                    {new Intl.DateTimeFormat("pt-BR", {
                      timeZone: "America/Sao_Paulo",
                      day: "2-digit",
                      month: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                    }).format(new Date(i.return_contacted_at!))}
                  </p>
                </div>
                <UndoReturnButton id={i.booking_id} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
