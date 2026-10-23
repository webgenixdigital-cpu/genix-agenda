import Link from "next/link";
import { ChevronRight, Search } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getAdminContext } from "@/lib/admin";
import { brl, maskPhone } from "@/lib/format";
import { CustomerDialog } from "@/components/admin/clientes/customer-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const dynamic = "force-dynamic";

type Props = { searchParams: { q?: string } };
type Summary = { customer_id: string; visits: number; last_visit: string | null; next_visit: string | null; total: number };

const br = (iso: string | null) => (iso ? iso.split("-").reverse().join("/") : "—");

// ---------------------------------------------------------------------
// PARTE 1 — Dados (o banco já limita aos clientes que o papel pode ver)
// ---------------------------------------------------------------------
export default async function ClientesPage({ searchParams }: Props) {
  const { business, role } = await getAdminContext();
  const supabase = createClient();
  const q = (searchParams.q ?? "").replace(/[,()%]/g, " ").trim().slice(0, 60);
  const qDigits = q.replace(/\D/g, "");

  let query = supabase.from("customers").select("id, name, phone").eq("business_id", business.id).order("name").limit(300);
  if (q) query = qDigits.length >= 4 ? query.ilike("phone", `%${qDigits}%`) : query.ilike("name", `%${q}%`);

  const [{ data: customers }, { data: summary }] = await Promise.all([
    query,
    supabase.rpc("customer_summary", { bid: business.id }),
  ]);

  const stats = new Map(((summary ?? []) as Summary[]).map((s) => [s.customer_id, s]));
  const list = customers ?? [];
  const canCreate = role === "owner" || role === "reception";

  // -------------------------------------------------------------------
  // PARTE 2 — Página
  // -------------------------------------------------------------------
  return (
    <main className="mx-auto max-w-5xl space-y-6 p-4 md:p-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl md:text-4xl">Clientes</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {role === "staff" ? "Clientes que você já atendeu ou tem agendados." : "Todos os clientes que já agendaram no espaço."}
          </p>
        </div>
        {canCreate && <CustomerDialog />}
      </header>

      <form action="/admin/clientes" className="flex max-w-md gap-2" role="search">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input name="q" defaultValue={q} placeholder="Nome ou WhatsApp" className="h-11 bg-white pl-9" data-testid="input-busca-cliente" />
        </div>
        <Button type="submit" variant="outline" className="h-11">Buscar</Button>
      </form>

      {list.length === 0 ? (
        <div className="rounded-2xl border border-dashed bg-white p-10 text-center">
          <p className="font-heading text-2xl">{q ? "Nenhum cliente encontrado" : "Nenhum cliente ainda"}</p>
          <p className="mt-2 text-muted-foreground">Os clientes entram aqui sozinhos a cada agendamento.</p>
        </div>
      ) : (
        <ul className="divide-y rounded-2xl border bg-card">
          {list.map((c) => {
            const s = stats.get(c.id);
            return (
              <li key={c.id}>
                <Link href={`/admin/clientes/${c.id}`} className="flex items-center gap-3 p-4 hover:bg-secondary/50 md:px-5" data-testid={`cliente-${c.id}`}>
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-secondary font-heading text-lg text-primary">
                    {c.name.charAt(0).toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{c.name}</p>
                    <p className="text-sm text-muted-foreground">{maskPhone(c.phone)}</p>
                  </div>
                  <div className="hidden text-right text-sm sm:block">
                    <p>{s?.visits ?? 0} {s?.visits === 1 ? "visita" : "visitas"} · {brl(s?.total ?? 0)}</p>
                    <p className="text-xs text-muted-foreground">
                      {s?.next_visit ? `Próximo: ${br(s.next_visit)}` : `Última: ${br(s?.last_visit ?? null)}`}
                    </p>
                  </div>
                  <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {list.length === 300 && <p className="text-center text-sm text-muted-foreground">Mostrando os 300 primeiros. Use a busca para encontrar outros.</p>}
    </main>
  );
}
