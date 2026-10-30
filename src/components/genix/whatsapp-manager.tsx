"use client";

import { useState, useTransition } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { saveWhatsappInstance, testWhatsappInstance } from "@/app/genix/whatsapp-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { reasonLabel } from "@/lib/whatsapp/templates";
import { cn } from "@/lib/utils";

/** Linha de genix_whatsapp_overview() — sem credenciais */
export type WhatsappOverview = {
  business_id: string;
  name: string;
  slug: string;
  tier: string;
  has_credentials: boolean;
  instance_hint: string | null;
  genix_enabled: boolean;
  status: "unknown" | "connected" | "disconnected";
  status_checked_at: string | null;
  auto_enabled: boolean;
  sent_7d: number;
  failed_7d: number;
  last_reason: string | null;
};

const STATUS: Record<WhatsappOverview["status"], { label: string; cls: string }> = {
  connected: { label: "Conectado", cls: "bg-green-100 text-green-800" },
  disconnected: { label: "Desconectado", cls: "bg-red-100 text-red-800" },
  unknown: { label: "Sem conferência", cls: "bg-stone-100 text-stone-700" },
};

const when = (ts: string) =>
  new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(ts));

export function WhatsappManager({ rows }: { rows: WhatsappOverview[] }) {
  const [q, setQ] = useState("");
  const list = rows.filter((r) => `${r.name} ${r.slug}`.toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <div className="space-y-4">
      <p className="max-w-2xl text-sm text-muted-foreground">
        Integração não oficial (Z-API, beta). A Genix contrata 1 instância por espaço; as credenciais ficam só no servidor e
        não aparecem de volta nesta tela. Campo vazio mantém o valor já cadastrado.
      </p>
      <Input
        className="h-11 max-w-sm"
        placeholder="Buscar espaço"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        data-testid="input-busca-whatsapp"
      />
      <ul className="space-y-3">
        {list.map((r) => (
          <InstanceCard key={r.business_id} row={r} />
        ))}
      </ul>
    </div>
  );
}

function InstanceCard({ row }: { row: WhatsappOverview }) {
  const [pending, start] = useTransition();
  const [enabled, setEnabled] = useState(row.genix_enabled);
  const [instanceId, setInstanceId] = useState("");
  const [token, setToken] = useState("");
  const [clientToken, setClientToken] = useState("");
  const st = STATUS[row.status] ?? STATUS.unknown;

  function save() {
    start(async () => {
      const r = await saveWhatsappInstance({ businessId: row.business_id, enabled, instanceId, token, clientToken });
      if (r.ok) {
        toast.success(`Instância de ${row.name} salva`);
        setInstanceId("");
        setToken("");
        setClientToken("");
      } else toast.error(r.error);
    });
  }

  function test() {
    start(async () => {
      const r = await testWhatsappInstance(row.business_id);
      if (r.ok) toast.success(r.connected ? "Conectado" : "Instância respondeu: número desconectado");
      else toast.error(r.error);
    });
  }

  const id = row.business_id.slice(0, 8);
  return (
    <li className="rounded-2xl border bg-card p-4 md:p-5" data-testid={`whatsapp-espaco-${row.slug}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-semibold">{row.name}</p>
          <p className="text-sm text-muted-foreground">
            /v/{row.slug} · plano {row.tier === "completo" ? "Completo" : "Grátis"} ·{" "}
            {row.auto_enabled ? "automático ligado pelo espaço" : "automático desligado pelo espaço"}
          </p>
        </div>
        <span className={cn("rounded-full px-3 py-1 text-xs font-semibold", st.cls)}>
          {st.label}
          {row.status_checked_at && ` · ${when(row.status_checked_at)}`}
        </span>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor={`wa-inst-${id}`}>Instance id</Label>
          <Input
            id={`wa-inst-${id}`}
            className="h-11"
            autoComplete="off"
            placeholder={row.instance_hint ? `cadastrado (…${row.instance_hint})` : "não cadastrado"}
            value={instanceId}
            onChange={(e) => setInstanceId(e.target.value)}
            data-testid={`input-wa-instance-${row.slug}`}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`wa-token-${id}`}>Token</Label>
          <Input
            id={`wa-token-${id}`}
            type="password"
            className="h-11"
            autoComplete="off"
            placeholder={row.has_credentials ? "cadastrado ✓" : "não cadastrado"}
            value={token}
            onChange={(e) => setToken(e.target.value)}
            data-testid={`input-wa-token-${row.slug}`}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`wa-client-${id}`}>Client-Token</Label>
          <Input
            id={`wa-client-${id}`}
            type="password"
            className="h-11"
            autoComplete="off"
            placeholder={row.has_credentials ? "cadastrado ✓" : "não cadastrado"}
            value={clientToken}
            onChange={(e) => setClientToken(e.target.value)}
            data-testid={`input-wa-client-token-${row.slug}`}
          />
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <label className="flex min-h-11 cursor-pointer items-center gap-3">
          <Switch checked={enabled} onCheckedChange={setEnabled} data-testid={`switch-wa-liberado-${row.slug}`} />
          <span className="text-sm font-medium">Liberado para este espaço</span>
        </label>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button
            variant="outline"
            className="h-11"
            disabled={pending || !row.has_credentials}
            onClick={test}
            data-testid={`btn-wa-testar-${row.slug}`}
          >
            <RefreshCw className="mr-1.5 h-4 w-4" /> Testar status
          </Button>
          <Button className="h-11" disabled={pending} onClick={save} data-testid={`btn-wa-salvar-${row.slug}`}>
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Salvar"}
          </Button>
        </div>
      </div>

      {(row.sent_7d > 0 || row.failed_7d > 0) && (
        <p className="mt-3 text-xs text-muted-foreground">
          Últimos 7 dias: {row.sent_7d} {row.sent_7d === 1 ? "enviado" : "enviados"}, {row.failed_7d}{" "}
          {row.failed_7d === 1 ? "falha" : "falhas"}
          {row.last_reason && ` · última falha: ${reasonLabel(row.last_reason)}`}
        </p>
      )}
    </li>
  );
}
