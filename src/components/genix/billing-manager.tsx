"use client";

import { useTransition } from "react";
import { ExternalLink, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { syncBillingNow } from "@/app/genix/billing-actions";
import { Button } from "@/components/ui/button";
import { brl } from "@/lib/format";
import { cn } from "@/lib/utils";

export type BillingOverview = {
  business_id: string;
  name: string;
  slug: string;
  status: string;
  plan_id: string | null;
  asaas_subscription_id: string | null;
  amount: number | null;
  expected: number | null;
  /** valor lido agora no Asaas (null = sem assinatura ou falha na leitura) */
  asaas_value: number | null;
  professionals: number | null;
  extra_professionals: number | null;
  sync_status: string;
  sync_error: string | null;
  synced_at: string | null;
  open_extras: number;
  overdue_extras: number;
  blocked_professionals: number;
  open_invoice_url: string | null;
};

const same = (a: number | null, b: number | null) => a !== null && b !== null && Math.round(a * 100) === Math.round(b * 100);

/** /genix → Assinaturas: valor esperado × gravado × Asaas, sincronia e avulsas de extra */
export function BillingManager({ rows }: { rows: BillingOverview[] }) {
  const [pending, start] = useTransition();

  function sync(r: BillingOverview) {
    start(async () => {
      const res = await syncBillingNow(r.business_id);
      if (res.ok) toast.success(`${r.name}: sincronizado`);
      else toast.error(res.error);
    });
  }

  if (rows.length === 0) {
    return <p className="rounded-2xl border bg-white p-6 text-sm text-muted-foreground">Nenhuma assinatura no Asaas por enquanto.</p>;
  }

  const outOfSync = rows.filter((r) => r.sync_status === "pendente" || !same(r.expected, r.asaas_value ?? r.amount)).length;

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        {outOfSync === 0 ? "Todas as assinaturas estão com o valor esperado." : `${outOfSync} fora de sincronia.`} O valor no Asaas é lido
        agora, na abertura desta aba.
      </p>
      <ul className="grid gap-3 md:grid-cols-2">
        {rows.map((r) => {
          const bad = r.sync_status === "pendente" || !same(r.expected, r.asaas_value ?? r.amount);
          return (
            <li
              key={r.business_id}
              className={cn("space-y-2 rounded-2xl border bg-white p-4 text-sm", bad && "border-amber-300 bg-amber-50")}
              data-testid={`assinatura-genix-${r.slug}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-semibold">{r.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {r.plan_id ?? "sem plano"} · {r.status} · {r.professionals ?? "—"} ativos ({r.extra_professionals ?? 0} extras)
                  </p>
                </div>
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-xs font-medium",
                    bad ? "bg-amber-200 text-amber-900" : "bg-emerald-100 text-emerald-800"
                  )}
                >
                  {bad ? "a sincronizar" : "ok"}
                </span>
              </div>
              <dl className="grid grid-cols-3 gap-2">
                <div>
                  <dt className="text-xs text-muted-foreground">Esperado</dt>
                  <dd className="font-medium">{r.expected !== null ? brl(r.expected) : "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Gravado</dt>
                  <dd className="font-medium">{r.amount !== null ? brl(r.amount) : "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">No Asaas</dt>
                  <dd className="font-medium">{r.asaas_value !== null ? brl(r.asaas_value) : "—"}</dd>
                </div>
              </dl>
              {r.sync_error && <p className="text-xs text-amber-900">Último erro: {r.sync_error}</p>}
              {r.open_extras > 0 && (
                <p className="text-xs">
                  Avulsas de extra em aberto: {r.open_extras} ({r.overdue_extras} vencidas)
                  {r.blocked_professionals > 0 && ` · ${r.blocked_professionals} fora da vitrine`}
                  {r.open_invoice_url && (
                    <a href={r.open_invoice_url} target="_blank" rel="noopener noreferrer" className="ml-2 inline-flex items-center underline">
                      fatura <ExternalLink className="ml-0.5 h-3 w-3" />
                    </a>
                  )}
                </p>
              )}
              {r.asaas_subscription_id && (
                <Button
                  variant="outline"
                  className="h-11"
                  disabled={pending}
                  onClick={() => sync(r)}
                  data-testid={`btn-sincronizar-${r.slug}`}
                >
                  <RefreshCw className="mr-1.5 h-4 w-4" /> Sincronizar agora
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
