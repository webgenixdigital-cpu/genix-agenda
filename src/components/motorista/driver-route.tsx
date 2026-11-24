"use client";

// 4c — Rota do dia no celular do motorista (link simples, sem login)
import { useCallback, useEffect, useState, useTransition } from "react";
import { Car, Loader2, MapPin, MessageCircle, Navigation, PawPrint, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { driverSetStatus, loadDriverStops, type DriverData } from "@/app/motorista/[token]/actions";
import { whatsappLink } from "@/lib/format";
import { ROUTE_STATUS_LABEL, type RouteStatus } from "@/lib/pets";
import { cn } from "@/lib/utils";

export type DriverStop = {
  key: string;
  routeIds: string[];
  kind: "busca" | "entrega";
  status: string;
  time: string;
  tutor: string;
  phone: string;
  phoneCountry: string | null;
  address: string | null;
  addressRef: string | null;
  pets: string[];
};

/** próximo passo de cada parada (um botão grande por vez) */
const NEXT: Record<string, { status: RouteStatus; label: string } | null> = {
  "busca:aguardando": { status: "a_caminho", label: "Estou a caminho" },
  "busca:a_caminho": { status: "coletado", label: "Peguei o pet" },
  "busca:coletado": { status: "na_loja", label: "Pet na loja" },
  "entrega:aguardando": { status: "saiu_entrega", label: "Saí para entregar" },
  "entrega:na_loja": { status: "saiu_entrega", label: "Saí para entregar" },
  "entrega:saiu_entrega": { status: "entregue", label: "Entreguei" },
};

const DONE = ["na_loja", "entregue", "cancelado"];

export function DriverRoute({ token, initial, valid }: { token: string; initial: DriverData; valid: boolean }) {
  const [data, setData] = useState(initial);
  const [pending, start] = useTransition();
  const [loading, setLoading] = useState(false);
  const { stops, driverName, businessName } = data;

  // busca direto no servidor (o botão, a cada 20 s e ao voltar para o app)
  const reload = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      setData(await loadDriverStops(token));
    } catch {
      toast.error("Sem conexão. Tente de novo.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void reload();
    }, 20000);
    const onVisible = () => document.visibilityState === "visible" && void reload();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [reload]);

  function advance(s: DriverStop, status: RouteStatus) {
    start(async () => {
      const r = await driverSetStatus(token, s.routeIds, status);
      if (r.ok) {
        toast.success(ROUTE_STATUS_LABEL[status]);
        await reload();
      } else toast.error(r.error);
    });
  }

  const open = stops.filter((s) => !DONE.includes(s.status));
  const done = stops.filter((s) => DONE.includes(s.status));

  return (
    <>
      <header className="flex items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-1.5 text-sm font-semibold text-[#99582A]"><Car className="h-4 w-4" /> Leva e traz</p>
          <h1 className="font-heading text-2xl leading-tight">{driverName ? `Olá, ${driverName.split(" ")[0]}!` : "Rota do dia"}</h1>
          {businessName && <p className="text-sm text-muted-foreground">{businessName} · hoje</p>}
        </div>
        <button type="button" onClick={() => void reload()} disabled={loading}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border bg-white" aria-label="Atualizar" data-testid="btn-motorista-atualizar">
          {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <RefreshCw className="h-5 w-5" />}
        </button>
      </header>

      {stops.length === 0 && (
        <div className="rounded-2xl border border-dashed bg-white p-8 text-center">
          <Car className="mx-auto h-10 w-10 text-[#99582A]" />
          <p className="mt-3 font-heading text-xl">Nenhuma parada para hoje</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {valid ? "Quando o espaço passar paradas para você, elas aparecem aqui. Toque em atualizar." : "Este link não é válido. Peça um link novo ao espaço."}
          </p>
        </div>
      )}

      <ol className="space-y-3">
        {open.map((s, i) => <Stop key={s.key} n={i + 1} s={s} pending={pending} onAdvance={advance} />)}
      </ol>

      {done.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-muted-foreground">Concluídas</h2>
          <ul className="divide-y rounded-2xl border bg-white">
            {done.map((s) => (
              <li key={s.key} className="flex items-center justify-between gap-2 p-3 text-sm">
                <span className="min-w-0 truncate">{s.kind === "busca" ? "Busca" : "Entrega"} · {s.pets.join(", ") || "Pet"} · {s.tutor}</span>
                <span className="shrink-0 text-xs font-medium text-green-700">{ROUTE_STATUS_LABEL[s.status as RouteStatus] ?? s.status}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

function Stop({ n, s, pending, onAdvance }: {
  n: number; s: DriverStop; pending: boolean; onAdvance: (s: DriverStop, status: RouteStatus) => void;
}) {
  const q = s.address ? encodeURIComponent(s.address) : null;
  const next = NEXT[`${s.kind}:${s.status}`] ?? null;
  const pets = s.pets.join(", ") || "o pet";
  const msg =
    s.kind === "busca"
      ? `Olá, ${s.tutor}! Aqui é do leva e traz. Estou chegando para buscar ${pets} 🐾`
      : `Olá, ${s.tutor}! Aqui é do leva e traz. Estou chegando para entregar ${pets} 🐾`;
  const wa = whatsappLink(s.phone, msg, s.phoneCountry);

  return (
    <li className="space-y-3 rounded-2xl border bg-white p-4" data-testid={`motorista-parada-${s.routeIds[0]}`}>
      <div className="flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#99582A] text-sm font-semibold text-white">{n}</span>
        <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", s.kind === "busca" ? "bg-sky-100 text-sky-800" : "bg-violet-100 text-violet-800")}>
          {s.kind === "busca" ? `Buscar até ${s.time}` : `Entregar a partir de ${s.time}`}
        </span>
        <span className="ml-auto text-xs text-muted-foreground">{ROUTE_STATUS_LABEL[s.status as RouteStatus] ?? s.status}</span>
      </div>

      <p className="flex items-center gap-1.5 text-lg font-semibold">
        <PawPrint className="h-5 w-5 text-[#99582A]" aria-hidden /> {s.pets.join(", ") || "Pet"}
        <span className="text-sm font-normal text-muted-foreground">· {s.tutor}</span>
      </p>
      <p className="flex items-start gap-1.5">
        <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <span>
          {s.address ?? <span className="text-destructive">Sem endereço. Fale com o espaço.</span>}
          {s.addressRef && <span className="block text-sm text-muted-foreground">{s.addressRef}</span>}
        </span>
      </p>

      <div className="grid grid-cols-3 gap-2">
        {q ? (
          <>
            <a href={`https://www.google.com/maps/dir/?api=1&destination=${q}`} target="_blank" rel="noopener noreferrer"
              className="flex min-h-12 flex-col items-center justify-center rounded-xl border text-xs font-medium" data-testid="btn-motorista-maps">
              <Navigation className="h-5 w-5" /> Maps
            </a>
            <a href={`https://waze.com/ul?q=${q}&navigate=yes`} target="_blank" rel="noopener noreferrer"
              className="flex min-h-12 flex-col items-center justify-center rounded-xl border text-xs font-medium" data-testid="btn-motorista-waze">
              <Navigation className="h-5 w-5" /> Waze
            </a>
          </>
        ) : (
          <span className="col-span-2" />
        )}
        {wa && (
          <a href={wa} target="_blank" rel="noopener noreferrer"
            className="flex min-h-12 flex-col items-center justify-center rounded-xl bg-whatsapp text-xs font-medium text-white" data-testid="btn-motorista-whatsapp">
            <MessageCircle className="h-5 w-5" /> Tutor
          </a>
        )}
      </div>

      {next && (
        <button type="button" disabled={pending} onClick={() => onAdvance(s, next.status)}
          className="flex min-h-14 w-full items-center justify-center rounded-xl bg-[#99582A] text-base font-semibold text-white disabled:opacity-60"
          data-testid="btn-motorista-proximo">
          {pending ? <Loader2 className="h-5 w-5 animate-spin" /> : next.label}
        </button>
      )}
    </li>
  );
}
