"use client";

// 4b — Paradas do dia: motorista, ordem e status (tempo real pelo Supabase)
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Car, MapPin, MessageCircle, PawPrint } from "lucide-react";
import { toast } from "sonner";
import { assignDriver, saveRouteOrder, setRouteStatus } from "@/app/admin/(painel)/leva-e-traz/actions";
import { createClient } from "@/lib/supabase/client";
import { brl, whatsappLink } from "@/lib/format";
import { ROUTE_FLOW, ROUTE_STATUS_LABEL, type RouteStatus } from "@/lib/pets";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

export type DriverRow = { id: string; name: string; phone: string | null; active: boolean };

export type RouteGroup = {
  key: string;
  routeIds: string[];
  kind: "busca" | "entrega";
  status: RouteStatus;
  order: number | null;
  driverId: string | null;
  /** busca: até o início do atendimento; entrega: a partir do fim */
  time: string;
  bookingStart: string;
  tutor: string;
  phone: string;
  phoneCountry: string | null;
  customerId: string | null;
  address: string | null;
  addressRef: string | null;
  pets: string[];
  fee: number;
};

const NONE = "__nenhum__";

const STATUS_STYLE: Record<RouteStatus, string> = {
  aguardando: "bg-stone-100 text-stone-700",
  a_caminho: "bg-amber-100 text-amber-800",
  coletado: "bg-sky-100 text-sky-800",
  na_loja: "bg-green-100 text-green-800",
  saiu_entrega: "bg-amber-100 text-amber-800",
  entregue: "bg-green-100 text-green-800",
  cancelado: "bg-red-50 text-destructive",
};

export function RoutesBoard({ businessId, groups, drivers, canManage }: {
  businessId: string; groups: RouteGroup[]; drivers: DriverRow[]; canManage: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [list, setList] = useState(groups);
  useEffect(() => setList(groups), [groups]);

  // tempo real: o motorista muda o status no celular e a tela atualiza
  useEffect(() => {
    const supabase = createClient();
    const ch = supabase
      .channel(`leva-traz-${businessId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "transport_routes", filter: `business_id=eq.${businessId}` }, () =>
        router.refresh()
      )
      .subscribe();
    // reforço: o tempo real às vezes não avisa (outra aba, celular dormindo, card da agenda)
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, 20000);
    const onFocus = () => router.refresh();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      supabase.removeChannel(ch);
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [businessId, router]);

  const run = (fn: () => Promise<{ ok: boolean; error?: string } | undefined>, okMsg?: string) =>
    start(async () => {
      const r = await fn();
      if (!r) return; // demonstração
      if (r.ok) {
        if (okMsg) toast.success(okMsg);
        router.refresh();
      } else toast.error(r.error ?? "Não foi possível salvar.");
    });

  function move(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    const next = [...list];
    [next[i], next[j]] = [next[j], next[i]];
    setList(next);
    run(() => saveRouteOrder(next.map((g) => g.routeIds)));
  }

  const activeDrivers = drivers.filter((d) => d.active);

  if (list.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed bg-white p-10 text-center">
        <Car className="mx-auto h-10 w-10 text-primary" />
        <p className="mt-3 font-heading text-2xl">Nenhum leva e traz neste dia</p>
        <p className="mt-1 text-sm text-muted-foreground">Marque o leva e traz no novo agendamento do pet.</p>
      </div>
    );
  }

  return (
    <ol className="space-y-3" data-testid="lista-leva-traz">
      {list.map((g, i) => {
        const maps = g.address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(g.address)}` : null;
        const wa = whatsappLink(g.phone, `Olá, ${g.tutor.split(" ")[0]}! Aqui é do leva e traz 🐾`, g.phoneCountry);
        return (
          <li key={g.key} className="rounded-2xl border bg-card p-4" data-testid={`parada-${g.routeIds[0]}`}>
            <div className="flex items-start gap-3">
              <div className="flex w-10 shrink-0 flex-col items-center gap-1">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
                  {i + 1}
                </span>
                {canManage && (
                  <>
                    <button type="button" className="flex h-11 w-11 items-center justify-center rounded-lg hover:bg-secondary disabled:opacity-30"
                      disabled={i === 0 || pending} onClick={() => move(i, -1)} aria-label="Subir na rota" data-testid="btn-parada-subir">
                      <ArrowUp className="h-4 w-4" />
                    </button>
                    <button type="button" className="flex h-11 w-11 items-center justify-center rounded-lg hover:bg-secondary disabled:opacity-30"
                      disabled={i === list.length - 1 || pending} onClick={() => move(i, 1)} aria-label="Descer na rota" data-testid="btn-parada-descer">
                      <ArrowDown className="h-4 w-4" />
                    </button>
                  </>
                )}
              </div>

              <div className="min-w-0 flex-1 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", g.kind === "busca" ? "bg-sky-100 text-sky-800" : "bg-violet-100 text-violet-800")}>
                    {g.kind === "busca" ? `Buscar até ${g.time}` : `Entregar a partir de ${g.time}`}
                  </span>
                  <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", STATUS_STYLE[g.status])}>{ROUTE_STATUS_LABEL[g.status]}</span>
                  {g.fee > 0 && <span className="text-xs text-muted-foreground">Taxa {brl(g.fee)} (à parte)</span>}
                </div>
                <p className="flex items-center gap-1.5 font-semibold">
                  <PawPrint className="h-4 w-4 text-primary" aria-hidden /> {g.pets.length ? g.pets.join(", ") : "Pet"}
                  <span className="font-normal text-muted-foreground">· Tutor: {g.tutor}</span>
                </p>
                <p className="flex items-start gap-1.5 text-sm">
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span>
                    {g.address ?? <span className="text-destructive">Sem endereço na ficha do tutor</span>}
                    {g.addressRef && <span className="text-muted-foreground"> · {g.addressRef}</span>}
                  </span>
                </p>

                <div className="flex flex-wrap gap-2">
                  {maps && (
                    <a href={maps} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center rounded-lg border bg-white px-3 text-sm font-medium"
                      data-testid="link-parada-mapa">
                      <MapPin className="mr-1.5 h-4 w-4" /> Mapa
                    </a>
                  )}
                  {wa && (
                    <a href={wa} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center rounded-lg bg-whatsapp px-3 text-sm font-medium text-white"
                      data-testid="link-parada-whatsapp">
                      <MessageCircle className="mr-1.5 h-4 w-4" /> Tutor
                    </a>
                  )}
                </div>

                {canManage ? (
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Select value={g.driverId ?? NONE} disabled={pending}
                      onValueChange={(v) => run(() => assignDriver(g.routeIds, v === NONE ? null : v), "Motorista atualizado")}>
                      <SelectTrigger className="h-11" aria-label="Motorista" data-testid="select-parada-motorista"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>Sem motorista</SelectItem>
                        {activeDrivers.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                        {g.driverId && !activeDrivers.some((d) => d.id === g.driverId) && (
                          <SelectItem value={g.driverId}>{drivers.find((d) => d.id === g.driverId)?.name ?? "Motorista"} (inativo)</SelectItem>
                        )}
                      </SelectContent>
                    </Select>
                    <Select value={g.status} disabled={pending}
                      onValueChange={(v) => run(() => setRouteStatus(g.routeIds, v as RouteStatus))}>
                      <SelectTrigger className="h-11" aria-label="Status" data-testid="select-parada-status"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {ROUTE_FLOW[g.kind].map((s) => <SelectItem key={s} value={s}>{ROUTE_STATUS_LABEL[s]}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Motorista: {drivers.find((d) => d.id === g.driverId)?.name ?? "sem motorista"}
                  </p>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
