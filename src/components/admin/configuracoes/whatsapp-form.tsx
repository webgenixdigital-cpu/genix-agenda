"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { AlertTriangle, CheckCircle2, Loader2, QrCode, RefreshCw, RotateCcw, WifiOff } from "lucide-react";
import { toast } from "sonner";
import {
  getWhatsappQr,
  refreshWhatsappStatus,
  saveWhatsappTemplates,
  setWhatsappAuto,
} from "@/app/admin/(painel)/configuracoes/whatsapp-actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { DEFAULT_TEMPLATES, TEMPLATE_VARS, renderTemplate } from "@/lib/whatsapp/templates";
import { addDaysISO, todayISO } from "@/lib/dates";
import { cn } from "@/lib/utils";

export type WhatsappPanelStatus = {
  genix_enabled: boolean;
  status: "unknown" | "connected" | "disconnected";
  status_checked_at: string | null;
  auto_enabled: boolean;
  risk_accepted_at: string | null;
  template_a: string | null;
  template_b: string | null;
};

const RISK_TEXT =
  "Integração não oficial do WhatsApp: existe risco de bloqueio do número pelo WhatsApp. Recomendamos usar um número dedicado ao atendimento.";

const QR_REFRESH_MS = 20_000;
const QR_MAX_TRIES = 15; // ~5 min com o QR aberto

const when = (ts: string) =>
  new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(ts));

export function WhatsappForm({
  initial,
  businessName,
  canEdit,
}: {
  initial: WhatsappPanelStatus;
  businessName: string;
  /** só a matriz; a demonstração vê a tela sem os botões de conexão */
  canEdit: boolean;
}) {
  const [connected, setConnected] = useState(initial.status === "connected");
  const [checkedAt, setCheckedAt] = useState(initial.status_checked_at);
  const [auto, setAuto] = useState(initial.auto_enabled);
  const [riskOpen, setRiskOpen] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [pending, start] = useTransition();

  if (!initial.genix_enabled) {
    return (
      <p className="rounded-xl border border-dashed bg-white p-4 text-sm text-muted-foreground" data-testid="whatsapp-nao-liberado">
        O envio automático está em fase beta e é liberado pela equipe Genix. Fale com a gente para ativar no seu espaço.
      </p>
    );
  }

  function refresh() {
    start(async () => {
      const r = await refreshWhatsappStatus();
      if (!r) return; // demonstração: o servidor redirecionou
      if (!r.ok) return void toast.error(r.error);
      setConnected(r.connected);
      setCheckedAt(new Date().toISOString());
      toast.success(r.connected ? "WhatsApp conectado" : "WhatsApp desconectado");
    });
  }

  function toggle(next: boolean) {
    if (next) {
      setAccepted(false);
      setRiskOpen(true);
      return;
    }
    start(async () => {
      const r = await setWhatsappAuto(false, false);
      if (!r) return;
      if (r.ok) {
        setAuto(false);
        toast.success("Lembretes automáticos desligados");
      } else toast.error(r.error);
    });
  }

  function confirmEnable() {
    start(async () => {
      const r = await setWhatsappAuto(true, accepted);
      if (!r) return;
      if (r.ok) {
        setAuto(true);
        setRiskOpen(false);
        toast.success("Lembretes automáticos ativados");
      } else toast.error(r.error);
    });
  }

  return (
    <div className="space-y-5">
      {/* Conexão */}
      <div
        className={cn(
          "flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center",
          connected ? "border-green-200 bg-green-50" : "border-amber-300 bg-amber-50"
        )}
        data-testid="whatsapp-status"
      >
        {connected ? (
          <CheckCircle2 className="h-6 w-6 shrink-0 text-green-700" />
        ) : (
          <WifiOff className="h-6 w-6 shrink-0 text-amber-700" />
        )}
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{connected ? "WhatsApp conectado" : "WhatsApp desconectado"}</p>
          <p className="text-sm text-muted-foreground">
            {connected
              ? "Os lembretes automáticos saem deste número."
              : "Conecte o número pelo QR Code. Enquanto estiver desconectado, nada é enviado."}
            {checkedAt && ` Conferido em ${when(checkedAt)}.`}
          </p>
        </div>
        {canEdit && (
          <Button variant="outline" className="h-11 bg-white" disabled={pending} onClick={refresh} data-testid="btn-whatsapp-status">
            <RefreshCw className="mr-1.5 h-4 w-4" /> Atualizar status
          </Button>
        )}
      </div>

      {canEdit && !connected && (
        <QrConnect
          onConnected={() => {
            setConnected(true);
            setCheckedAt(new Date().toISOString());
          }}
        />
      )}

      {/* Liga/desliga */}
      <label className="flex cursor-pointer items-center justify-between gap-4 rounded-xl border p-4">
        <span>
          <span className="block font-semibold">Enviar lembretes automaticamente</span>
          <span className="text-sm text-muted-foreground">
            Só para agendamentos confirmados, a partir das 08:00 da véspera, no máximo 6 por hora. O que não for enviado
            continua na fila de Lembretes.
          </span>
        </span>
        <Switch checked={auto} onCheckedChange={toggle} disabled={pending} data-testid="switch-whatsapp-automatico" />
      </label>

      <TemplatesEditor initial={[initial.template_a, initial.template_b]} businessName={businessName} />

      <Dialog open={riskOpen} onOpenChange={setRiskOpen}>
        <DialogContent className="max-h-[92svh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-600" /> Antes de ativar
            </DialogTitle>
            <DialogDescription>{RISK_TEXT}</DialogDescription>
          </DialogHeader>
          <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border p-4 text-sm">
            <input
              type="checkbox"
              className="mt-0.5 h-5 w-5 accent-[#99582A]"
              checked={accepted}
              onChange={(e) => setAccepted(e.target.checked)}
              data-testid="check-whatsapp-risco"
            />
            Li e aceito o risco. Entendo que a Genix registra quem ativou e quando.
          </label>
          <DialogFooter className="gap-2">
            <Button variant="outline" className="h-11" onClick={() => setRiskOpen(false)} data-testid="btn-whatsapp-risco-cancelar">
              Cancelar
            </Button>
            <Button className="h-11" disabled={!accepted || pending} onClick={confirmEnable} data-testid="btn-whatsapp-risco-ativar">
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Ativar lembretes automáticos"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------
// QR Code: renova a cada 20 s enquanto aberto, para ao conectar
// ---------------------------------------------------------------------
function QrConnect({ onConnected }: { onConnected: () => void }) {
  const [open, setOpen] = useState(false);
  const [image, setImage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const tries = useRef(0);
  const onConnectedRef = useRef(onConnected);
  onConnectedRef.current = onConnected;

  useEffect(() => {
    if (!open) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;

    async function load() {
      tries.current++;
      const r = await getWhatsappQr();
      if (!alive || !r) return;
      if (!r.ok) {
        setError(r.error);
      } else if ("connected" in r) {
        setOpen(false);
        toast.success("WhatsApp conectado");
        onConnectedRef.current();
        return;
      } else {
        setError(null);
        setImage(r.image);
      }
      if (tries.current < QR_MAX_TRIES) timer = setTimeout(load, QR_REFRESH_MS);
      else setOpen(false);
    }

    tries.current = 0;
    load();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [open]);

  if (!open) {
    return (
      <Button className="h-11" onClick={() => setOpen(true)} data-testid="btn-whatsapp-qr">
        <QrCode className="mr-1.5 h-4 w-4" /> Conectar pelo QR Code
      </Button>
    );
  }

  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border bg-white p-5 text-center" data-testid="whatsapp-qr">
      {image ? (
        // eslint-disable-next-line @next/next/no-img-element -- data URL vinda da Z-API
        <img src={image} alt="QR Code para conectar o WhatsApp" className="h-60 w-60" />
      ) : (
        <div className="grid h-60 w-60 place-items-center">
          {error ? <p className="text-sm text-red-700">{error}</p> : <Loader2 className="h-8 w-8 animate-spin text-primary" />}
        </div>
      )}
      <p className="max-w-sm text-sm text-muted-foreground">
        No celular do atendimento, abra o WhatsApp → <strong className="text-foreground">Aparelhos conectados</strong> →{" "}
        <strong className="text-foreground">Conectar um aparelho</strong> e aponte para o código. Ele se renova sozinho.
      </p>
      <Button variant="ghost" className="h-11" onClick={() => setOpen(false)} data-testid="btn-whatsapp-qr-fechar">
        Fechar
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------
// Textos A/B (alternam a cada envio)
// ---------------------------------------------------------------------
function TemplatesEditor({ initial, businessName }: { initial: (string | null)[]; businessName: string }) {
  const [texts, setTexts] = useState<string[]>([initial[0] ?? DEFAULT_TEMPLATES[0], initial[1] ?? DEFAULT_TEMPLATES[1]]);
  const [pending, start] = useTransition();
  const refs = [useRef<HTMLTextAreaElement>(null), useRef<HTMLTextAreaElement>(null)];

  const sample = {
    customerName: "Ana Souza",
    serviceName: "Corte e escova",
    professionalName: "Carla",
    date: addDaysISO(todayISO(), 1),
    time: "14:30",
    businessName,
  };

  function set(i: number, v: string) {
    setTexts((t) => t.map((x, j) => (j === i ? v : x)));
  }

  function insertVar(i: number, key: string) {
    const el = refs[i].current;
    const token = `{${key}}`;
    const t = texts[i];
    const pos = el ? el.selectionStart : t.length;
    set(i, t.slice(0, pos) + token + t.slice(el ? el.selectionEnd : t.length));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(pos + token.length, pos + token.length);
    });
  }

  function save() {
    start(async () => {
      // texto igual ao padrão é gravado vazio (acompanha melhorias futuras do padrão)
      const [a, b] = texts.map((t, i) => (t.trim() === DEFAULT_TEMPLATES[i].trim() ? "" : t));
      const r = await saveWhatsappTemplates(a, b);
      if (!r) return;
      if (r.ok) toast.success("Textos salvos");
      else toast.error(r.error);
    });
  }

  return (
    <div className="space-y-5">
      <div>
        <p className="font-semibold">Textos do lembrete</p>
        <p className="text-sm text-muted-foreground">Os dois textos se alternam para a mensagem não ser sempre igual.</p>
      </div>

      {texts.map((t, i) => {
        const letter = i === 0 ? "a" : "b";
        return (
          <div key={letter} className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor={`wa-texto-${letter}`}>Texto {letter.toUpperCase()}</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-10 text-muted-foreground"
                onClick={() => set(i, DEFAULT_TEMPLATES[i])}
                data-testid={`btn-whatsapp-texto-padrao-${letter}`}
              >
                <RotateCcw className="mr-1.5 h-4 w-4" /> Restaurar padrão
              </Button>
            </div>
            <Textarea
              id={`wa-texto-${letter}`}
              ref={refs[i]}
              rows={7}
              maxLength={1000}
              value={t}
              onChange={(e) => set(i, e.target.value)}
              data-testid={`textarea-whatsapp-texto-${letter}`}
            />
            <div className="flex flex-wrap gap-2">
              {TEMPLATE_VARS.map((v) => (
                <button
                  key={v.key}
                  type="button"
                  className="min-h-11 rounded-full border bg-white px-3 text-xs font-medium hover:bg-secondary"
                  onClick={() => insertVar(i, v.key)}
                  data-testid={`btn-whatsapp-var-${letter}-${v.key.replace(/_/g, "-")}`}
                >
                  {`{${v.key}}`} <span className="text-muted-foreground">· {v.label}</span>
                </button>
              ))}
            </div>
            <div className="rounded-xl bg-[#E7F7E1] p-3 text-sm">
              <p className="mb-1 text-xs font-semibold text-muted-foreground">Prévia</p>
              <p className="whitespace-pre-line">{renderTemplate(t, sample)}</p>
            </div>
          </div>
        );
      })}

      <Button className="h-12 w-full text-base sm:w-auto sm:px-8" disabled={pending} onClick={save} data-testid="btn-salvar-whatsapp-textos">
        {pending ? <Loader2 className="h-5 w-5 animate-spin" /> : "Salvar textos"}
      </Button>
    </div>
  );
}
