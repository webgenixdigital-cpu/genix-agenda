// /genix → Indicações (migrations 56 e 61): todas as indicações e prêmios, para auditoria. Só leitura.
import { cn } from "@/lib/utils";

export type GenixReferral = {
  id: string;
  referrer: string;
  referrer_slug: string;
  referred: string;
  referred_slug: string;
  status: string;
  blocked_reason: string | null;
  created_at: string;
  paid_at: string | null;
  first_payment_id: string | null;
  first_plan_id: string | null;
  reward_status: string | null;
  reward_note: string | null;
  granted_at: string | null;
  applied_at: string | null;
  applied_payment_id: string | null;
  due_before: string | null;
  due_after: string | null;
  canceled_at: string | null;
  /** 61: 'mes' (1 mês grátis, regra antiga) | 'credito' */
  reward_kind?: string | null;
  referred_monthly?: number | string | null;
  applied_as?: "reducao" | "adiamento" | null;
  credit_amount?: number | string | null;
  payment_value_before?: number | string | null;
  payment_value_after?: number | string | null;
};

const money = (v: number | string | null | undefined) =>
  v == null ? "—" : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** o que o prêmio virou (61): mês grátis antigo, crédito guardado, redução ou adiamento */
function rewardDetail(r: GenixReferral) {
  if (r.reward_kind !== "credito") return "1 mês grátis (regra antiga)";
  const base = `crédito até ${money(r.referred_monthly)}`;
  if (r.applied_as === "reducao") {
    return `${base} · usado ${money(r.credit_amount)}: cobrança ${money(r.payment_value_before)} → ${money(r.payment_value_after)}`;
  }
  if (r.applied_as === "adiamento") return `${base} · virou 1 mês grátis (mensalidade ${money(r.credit_amount)})`;
  return base;
}

const br = (iso: string | null) =>
  iso
    ? new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric" }).format(
        new Date(iso.length === 10 ? `${iso}T12:00:00` : iso)
      )
    : "—";

const REWARD: Record<string, string> = {
  guardado: "prêmio guardado",
  aplicado: "prêmio aplicado",
  cancelado: "prêmio cancelado",
  bloqueado: "prêmio bloqueado",
};

export function ReferralsManager({ rows }: { rows: GenixReferral[] }) {
  if (rows.length === 0) {
    return <p className="rounded-2xl border bg-white p-6 text-sm text-muted-foreground">Nenhuma indicação por enquanto.</p>;
  }
  const count = (s: string) => rows.filter((r) => r.reward_status === s).length;
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        {rows.length} {rows.length === 1 ? "indicação" : "indicações"} · {count("guardado")} guardados · {count("aplicado")} aplicados ·{" "}
        {count("cancelado")} cancelados · {count("bloqueado")} bloqueados
      </p>
      <ul className="grid gap-3 md:grid-cols-2">
        {rows.map((r) => (
          <li
            key={r.id}
            className={cn(
              "space-y-1 rounded-2xl border bg-white p-4 text-sm",
              (r.status === "bloqueado" || r.reward_status === "bloqueado" || r.reward_note?.startsWith("Falha")) &&
                "border-amber-300 bg-amber-50"
            )}
            data-testid={`indicacao-genix-${r.referred_slug}`}
          >
            <p className="font-semibold">
              {r.referrer} → {r.referred}
            </p>
            <p className="text-xs text-muted-foreground">
              cadastro {br(r.created_at)} · situação {r.status}
              {r.blocked_reason ? ` (${r.blocked_reason})` : ""}
              {r.paid_at ? ` · pagou ${br(r.paid_at)} (${r.first_plan_id ?? "—"}, ${r.first_payment_id ?? "—"})` : ""}
            </p>
            {r.reward_status && (
              <p className="text-xs">
                {REWARD[r.reward_status] ?? r.reward_status} em {br(r.granted_at)} · {rewardDetail(r)}
                {r.reward_status === "aplicado" && r.due_before && r.applied_as !== "reducao"
                  ? ` · cobrança ${r.applied_payment_id ?? "(próxima a gerar)"}: ${br(r.due_before)} → ${br(r.due_after)}`
                  : ""}
                {r.applied_as === "reducao" ? ` · cobrança ${r.applied_payment_id} de ${br(r.due_before)}` : ""}
                {r.canceled_at ? ` · cancelado ${br(r.canceled_at)}` : ""}
                {r.reward_note ? ` · ${r.reward_note}` : ""}
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
