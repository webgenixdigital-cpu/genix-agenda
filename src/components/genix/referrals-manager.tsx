// /genix → Indicações (migration 56): todas as indicações e prêmios, para auditoria. Só leitura.
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
};

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
                {REWARD[r.reward_status] ?? r.reward_status} em {br(r.granted_at)}
                {r.reward_status === "aplicado" && r.due_before
                  ? ` · cobrança ${r.applied_payment_id ?? "(próxima a gerar)"}: ${br(r.due_before)} → ${br(r.due_after)}`
                  : ""}
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
