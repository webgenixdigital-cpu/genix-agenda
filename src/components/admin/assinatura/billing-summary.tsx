import { AlertTriangle, ExternalLink, Users } from "lucide-react";
import { brl } from "@/lib/format";
import { Button } from "@/components/ui/button";

export type BillingChange = {
  id: string;
  kind: "valor" | "avulsa";
  reason: string;
  professionals: number | null;
  extra_professionals: number | null;
  old_amount: number | null;
  new_amount: number | null;
  payment_value: number | null;
  payment_due_date: string | null;
  payment_status: string | null;
  invoice_url: string | null;
  created_at: string;
};

const REASON: Record<string, string> = {
  ativou: "Profissional ativado",
  cadastrou: "Profissional cadastrado",
  desativou: "Profissional desativado",
  excluiu: "Profissional excluído",
  webhook: "Ajuste automático da cobrança",
  genix: "Ajuste pela Genix",
  sincronia: "Ajuste da cobrança",
};

const PAYMENT_STATUS: Record<string, string> = {
  PENDING: "em aberto",
  OVERDUE: "vencida",
  PAID: "paga",
  CANCELED: "cancelada",
};

const br = (iso: string) =>
  new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric" }).format(
    new Date(iso.length === 10 ? `${iso}T12:00:00` : iso)
  );

/** Assinatura do Equipe: quantos profissionais entram no valor, avulsas em aberto e histórico */
export function BillingSummary({
  professionals,
  included,
  extras,
  amount,
  expected,
  syncPending,
  changes,
}: {
  professionals: number;
  included: number;
  extras: number;
  /** valor atual no sistema de pagamentos */
  amount: number | null;
  /** valor esperado para a próxima cobrança (calculado no banco) */
  expected: number | null;
  syncPending: boolean;
  changes: BillingChange[];
}) {
  const open = changes.filter((c) => c.kind === "avulsa" && (c.payment_status === "PENDING" || c.payment_status === "OVERDUE"));
  const differs = amount !== null && expected !== null && Math.round(amount * 100) !== Math.round(expected * 100);

  return (
    <section className="space-y-4 rounded-2xl border bg-card p-5" data-testid="resumo-cobranca-equipe">
      <div className="flex gap-3">
        <Users className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
        <div className="space-y-1 text-sm">
          <p className="font-semibold">
            Você paga por {professionals} {professionals === 1 ? "profissional" : "profissionais"} ({included} inclusos
            {extras > 0 ? ` + ${extras} ${extras === 1 ? "extra" : "extras"}` : ""})
          </p>
          {amount !== null && (
            <p className="text-muted-foreground">
              Valor atual: <strong className="text-foreground">{brl(amount)}</strong>
              {differs && expected !== null && (
                <>
                  {" "}· Próxima cobrança: <strong className="text-foreground">{brl(expected)}</strong>
                </>
              )}
            </p>
          )}
          {syncPending && (
            <p className="text-amber-800" data-testid="aviso-cobranca-sincronizando">
              Estamos ajustando o valor com o sistema de pagamentos. Isso acontece sozinho em instantes.
            </p>
          )}
        </div>
      </div>

      {open.map((c) => (
        <div
          key={c.id}
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900"
          data-testid="avulsa-extra-aberta"
        >
          <p className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              Cobrança de profissional extra de {brl(c.payment_value)}
              {c.payment_due_date ? `, vencimento em ${br(c.payment_due_date)}` : ""} ({PAYMENT_STATUS[c.payment_status ?? ""]}).
            </span>
          </p>
          {c.invoice_url && (
            <Button asChild className="h-11" data-testid="btn-pagar-avulsa-extra">
              <a href={c.invoice_url} target="_blank" rel="noopener noreferrer">
                Pagar <ExternalLink className="ml-1.5 h-4 w-4" />
              </a>
            </Button>
          )}
        </div>
      ))}

      {changes.length > 0 && (
        <details className="border-t pt-3 text-sm" data-testid="historico-cobranca">
          <summary className="flex min-h-11 cursor-pointer items-center font-medium">Histórico de mudanças de valor</summary>
          <ul className="mt-2 space-y-2">
            {changes.map((c) => (
              <li key={c.id} className="flex flex-wrap justify-between gap-x-4 gap-y-0.5 rounded-lg bg-secondary px-3 py-2">
                <span>
                  {br(c.created_at)} · {REASON[c.reason] ?? "Ajuste"}
                  {c.professionals !== null ? ` (${c.professionals} ativos)` : ""}
                </span>
                <span className="text-muted-foreground">
                  {c.kind === "avulsa"
                    ? `Avulsa proporcional de ${brl(c.payment_value)} (${PAYMENT_STATUS[c.payment_status ?? ""] ?? "—"})`
                    : `${brl(c.old_amount)} → ${brl(c.new_amount)}`}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
