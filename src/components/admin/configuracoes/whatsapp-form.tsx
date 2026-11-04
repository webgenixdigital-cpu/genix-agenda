"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import {
  Check,
  CheckCircle2,
  ChevronDown,
  Info,
  Loader2,
  Lock,
  LogOut,
  QrCode,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  WifiOff,
} from "lucide-react";
import { toast } from "sonner";
import {
  disconnectWhatsapp,
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
import { maskPhone } from "@/lib/format";
import { cn } from "@/lib/utils";

export type WhatsappPanelStatus = {
  /** liberado pela Genix E com instância pronta */
  genix_enabled: boolean;
  /** só a liberação da Genix */
  released?: boolean;
  provider?: "zapi" | "evolution" | null;
  has_instance?: boolean;
  phone_number?: string | null;
  status: "unknown" | "connected" | "disconnected";
  status_checked_at: string | null;
  auto_enabled: boolean;
  risk_accepted_at: string | null;
  template_a: string | null;
  template_b: string | null;
  /** migration 34; antes dela vem undefined (o editor usa o padrão) */
  template_c?: string | null;
};

/** Pontos do aviso de risco (recolhido no fim da seção e no aceite ao ligar) */
function RiskPoints({ className }: { className?: string }) {
  return (
    <ul className={cn("list-disc space-y-1 pl-4", className)}>
      <li>Esta é uma integração não oficial do WhatsApp.</li>
      <li>Use um número dedicado ao atendimento, não o seu número pessoal.</li>
      <li>O WhatsApp pode bloquear o número conectado, temporária ou definitivamente.</li>
    </ul>
  );
}

const SAFE_SENDING = [
  { title: "Limite por hora", text: "no máximo 6 mensagens por hora, com 10 minutos entre uma e outra." },
  { title: "3 versões de mensagem", text: "os lembretes alternam entre 3 textos diferentes." },
  { title: "Horário comercial", text: "só entre 8h e 20h e apenas para agendamentos confirmados." },
] as const;

const QR_REFRESH_MS = 30_000; // troca o QR
const STATE_POLL_MS = 5_000; // confere se já conectou
const QR_EXPIRE_MS = 3 * 60_000; // depois disso, pede um QR novo

const when = (ts: string) =>
  new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(ts));

export function WhatsappForm({
  initial,
  businessName,
  canEdit,
  selfConnect,
}: {
  initial: WhatsappPanelStatus;
  businessName: string;
  /** só a matriz; a demonstração vê a tela sem os botões de conexão */
  canEdit: boolean;
  /** Evolution: o próprio espaço conecta (antes da liberação). Z-API: só com a liberação. */
  selfConnect: boolean;
}) {
  const [connected, setConnected] = useState(initial.status === "connected");
  const [phone, setPhone] = useState(initial.phone_number ?? null);
  const [checkedAt, setCheckedAt] = useState(initial.status_checked_at);
  const [auto, setAuto] = useState(initial.auto_enabled);
  const [riskOpen, setRiskOpen] = useState(false);
  const [riskAcceptedAt, setRiskAcceptedAt] = useState(initial.risk_accepted_at);
  const [accepted, setAccepted] = useState(false);
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [pending, start] = useTransition();
  const released = initial.released ?? initial.genix_enabled;

  if (!selfConnect && !initial.genix_enabled) {
    return (
      <p className="rounded-xl border border-dashed bg-white p-4 text-sm text-muted-foreground" data-testid="whatsapp-nao-liberado">
        O envio automático está em fase beta e é liberado pela equipe Genix. Fale com a gente para ativar no seu espaço.
      </p>
    );
  }

  function markConnected(p: string | null) {
    setConnected(true);
    setPhone(p);
    setCheckedAt(new Date().toISOString());
  }

  function refresh() {
    start(async () => {
      const r = await refreshWhatsappStatus();
      if (!r) return; // demonstração: o servidor redirecionou
      if (!r.ok) return void toast.error(r.error);
      setConnected(r.connected);
      setPhone(r.phone);
      setCheckedAt(new Date().toISOString());
      toast.success(r.connected ? "WhatsApp conectado" : "WhatsApp desconectado");
    });
  }

  function disconnect() {
    start(async () => {
      const r = await disconnectWhatsapp();
      if (!r) return;
      if (!r.ok) return void toast.error(r.error);
      setConnected(false);
      setPhone(null);
      setCheckedAt(new Date().toISOString());
      setLogoutOpen(false);
      toast.success("WhatsApp desconectado");
    });
  }

  function toggle(next: boolean) {
    // primeira vez: o aviso abre junto com o aceite (obrigatório também no banco)
    if (next && !riskAcceptedAt) {
      setAccepted(false);
      setRiskOpen(true);
      return;
    }
    start(async () => {
      const r = await setWhatsappAuto(next, false);
      if (!r) return;
      if (r.ok) {
        setAuto(next);
        toast.success(next ? "Lembretes automáticos ativados" : "Lembretes automáticos desligados");
      } else if (next && r.error.includes("aviso de risco")) {
        // o banco não encontrou o aceite: pede de novo
        setRiskAcceptedAt(null);
        setAccepted(false);
        setRiskOpen(true);
      } else toast.error(r.error);
    });
  }

  function confirmEnable() {
    start(async () => {
      const r = await setWhatsappAuto(true, accepted);
      if (!r) return;
      if (r.ok) {
        setAuto(true);
        setRiskAcceptedAt(new Date().toISOString());
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
          connected ? "border-green-200 bg-green-50" : "border-red-200 bg-red-50"
        )}
        data-testid="whatsapp-status"
      >
        {connected ? (
          <CheckCircle2 className="h-6 w-6 shrink-0 text-green-700" />
        ) : (
          <WifiOff className="h-6 w-6 shrink-0 text-red-700" />
        )}
        <div className="min-w-0 flex-1">
          <p className="font-semibold" data-testid="whatsapp-status-texto">
            {connected ? "WhatsApp conectado" : "WhatsApp desconectado"}
            {connected && phone && <span className="font-normal"> · {maskPhone(phone)}</span>}
          </p>
          <p className="text-sm text-muted-foreground">
            {connected
              ? "Os lembretes automáticos saem deste número."
              : "Conecte o número pelo QR Code. Enquanto estiver desconectado, nada é enviado e os lembretes ficam na fila."}
            {checkedAt && ` Conferido em ${when(checkedAt)}.`}
          </p>
        </div>
        {canEdit && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" className="h-11 bg-white" disabled={pending} onClick={refresh} data-testid="btn-whatsapp-status">
              <RefreshCw className="mr-1.5 h-4 w-4" /> Atualizar status
            </Button>
            {connected && selfConnect && (
              <Button
                variant="outline"
                className="h-11 bg-white text-red-700 hover:text-red-800"
                disabled={pending}
                onClick={() => setLogoutOpen(true)}
                data-testid="btn-whatsapp-desconectar"
              >
                <LogOut className="mr-1.5 h-4 w-4" /> Desconectar
              </Button>
            )}
          </div>
        )}
      </div>

      {canEdit && !connected && <QrConnect onConnected={markConnected} />}

      {/* Liberação da Genix */}
      {!released && (
        <p className="flex gap-2 rounded-xl border border-dashed bg-white p-4 text-sm text-muted-foreground" data-testid="whatsapp-aguardando-liberacao">
          <Lock className="mt-0.5 h-4 w-4 shrink-0" />
          O envio automático está em fase beta e precisa ser liberado pela equipe Genix. Você já pode conectar o número; sem a
          liberação, nenhuma mensagem é enviada.
        </p>
      )}

      {/* Liga/desliga */}
      <label className={cn("flex items-center justify-between gap-4 rounded-xl border p-4", released ? "cursor-pointer" : "opacity-60")}>
        <span>
          <span className="block font-semibold">Enviar lembretes automaticamente</span>
          <span className="text-sm text-muted-foreground">
            Lembretes a partir da véspera, em ritmo seguro. O que não sair continua na fila.
          </span>
        </span>
        <Switch
          checked={auto}
          onCheckedChange={toggle}
          disabled={pending || !canEdit || (!released && !auto)}
          data-testid="switch-whatsapp-automatico"
        />
      </label>

      <TemplatesEditor
        initial={[initial.template_a, initial.template_b, initial.template_c ?? null]}
        businessName={businessName}
      />

      {/* Informativo: como o envio protege o número */}
      <div className="flex gap-3 rounded-xl border border-green-200 bg-green-50/60 p-4 text-sm" data-testid="whatsapp-envio-inteligente">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-green-700" />
        <div className="min-w-0 space-y-2">
          <p className="font-semibold text-green-900">Envio inteligente, pensado para proteger o seu número</p>
          <p className="text-muted-foreground">
            O WhatsApp identifica e bloqueia robôs que disparam muitas mensagens ao mesmo tempo. Por isso, o Genix Agenda
            envia como uma pessoa enviaria:
          </p>
          <ul className="space-y-1.5">
            {SAFE_SENDING.map((s) => (
              <li key={s.title} className="flex gap-2">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-green-700" />
                <span className="min-w-0">
                  <strong className="font-semibold">{s.title}:</strong> {s.text}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Aviso de risco, recolhido (o aceite aparece ao ligar pela primeira vez) */}
      <details className="group rounded-xl border bg-white text-sm text-muted-foreground" data-testid="whatsapp-aviso-risco">
        <summary
          className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-4 py-2 [&::-webkit-details-marker]:hidden"
          data-testid="btn-whatsapp-sobre-integracao"
        >
          Sobre a integração com o WhatsApp
          <ChevronDown className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180" />
        </summary>
        <div className="px-4 pb-4 text-xs leading-relaxed">
          <RiskPoints />
          {riskAcceptedAt && <p className="mt-2">Aviso aceito em {when(riskAcceptedAt)}.</p>}
        </div>
      </details>

      <Dialog open={riskOpen} onOpenChange={setRiskOpen}>
        <DialogContent className="max-h-[92svh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Info className="h-5 w-5 text-muted-foreground" /> Antes de ativar
            </DialogTitle>
            <DialogDescription asChild>
              <div className="text-sm text-muted-foreground">
                <p className="mb-2">Sobre a integração com o WhatsApp:</p>
                <RiskPoints />
              </div>
            </DialogDescription>
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

      <Dialog open={logoutOpen} onOpenChange={setLogoutOpen}>
        <DialogContent className="max-h-[92svh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Desconectar o WhatsApp?</DialogTitle>
            <DialogDescription>
              Os lembretes automáticos param até você conectar de novo pelo QR Code. Nada é apagado: os agendamentos continuam
              na fila.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" className="h-11" onClick={() => setLogoutOpen(false)} data-testid="btn-whatsapp-desconectar-cancelar">
              Cancelar
            </Button>
            <Button variant="destructive" className="h-11" disabled={pending} onClick={disconnect} data-testid="btn-whatsapp-desconectar-confirmar">
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Desconectar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------
// QR Code: cria a instância (se preciso) e mostra o QR; confere a conexão a
// cada 5 s, troca o QR a cada 30 s e expira em 3 min (pede um novo).
// ---------------------------------------------------------------------
function QrConnect({ onConnected }: { onConnected: (phone: string | null) => void }) {
  const [open, setOpen] = useState(false);
  const [expired, setExpired] = useState(false);
  /** cada "Gerar novo QR" começa uma rodada nova */
  const [round, setRound] = useState(0);
  const [image, setImage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const onConnectedRef = useRef(onConnected);
  onConnectedRef.current = onConnected;

  useEffect(() => {
    if (!open) return;
    let alive = true;
    let qrTimer: ReturnType<typeof setTimeout> | undefined;
    let pollTimer: ReturnType<typeof setTimeout> | undefined;
    const startedAt = Date.now();

    function done(phone: string | null) {
      alive = false;
      clearTimeout(qrTimer);
      clearTimeout(pollTimer);
      setOpen(false);
      toast.success("WhatsApp conectado");
      onConnectedRef.current(phone);
    }

    function expire() {
      alive = false;
      clearTimeout(qrTimer);
      clearTimeout(pollTimer);
      setImage(null);
      setExpired(true);
    }

    async function loadQr() {
      if (!alive) return;
      if (Date.now() - startedAt > QR_EXPIRE_MS) return expire();
      const r = await getWhatsappQr();
      if (!alive || !r) return;
      if (!r.ok) {
        setError(r.error);
        qrTimer = setTimeout(loadQr, QR_REFRESH_MS);
        return;
      }
      if ("connected" in r) return done(r.phone);
      if ("waiting" in r) {
        qrTimer = setTimeout(loadQr, 3_000); // QR ainda sendo gerado
        return;
      }
      setError(null);
      setImage(r.image);
      qrTimer = setTimeout(loadQr, QR_REFRESH_MS);
    }

    async function poll() {
      if (!alive) return;
      if (Date.now() - startedAt > QR_EXPIRE_MS) return expire();
      const r = await refreshWhatsappStatus();
      if (!alive || !r) return;
      if (r.ok && r.connected) return done(r.phone);
      pollTimer = setTimeout(poll, STATE_POLL_MS);
    }

    setExpired(false);
    setError(null);
    setImage(null);
    loadQr();
    pollTimer = setTimeout(poll, STATE_POLL_MS);
    return () => {
      alive = false;
      clearTimeout(qrTimer);
      clearTimeout(pollTimer);
    };
  }, [open, round]);

  if (!open) {
    return (
      <Button className="h-11" onClick={() => setOpen(true)} data-testid="btn-whatsapp-qr">
        <QrCode className="mr-1.5 h-4 w-4" /> Conectar WhatsApp
      </Button>
    );
  }

  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border bg-white p-5 text-center" data-testid="whatsapp-qr">
      {expired ? (
        <div className="grid h-60 w-60 max-w-full place-items-center rounded-xl border border-dashed p-4" data-testid="whatsapp-qr-expirado">
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">O QR Code expirou.</p>
            <Button
              className="h-11"
              onClick={() => setRound((n) => n + 1)}
              data-testid="btn-whatsapp-qr-novo"
            >
              <RefreshCw className="mr-1.5 h-4 w-4" /> Gerar novo QR
            </Button>
          </div>
        </div>
      ) : image ? (
        // eslint-disable-next-line @next/next/no-img-element -- data URL vinda do serviço de WhatsApp
        <img src={image} alt="QR Code para conectar o WhatsApp" className="h-60 w-60 max-w-full" />
      ) : (
        <div className="grid h-60 w-60 max-w-full place-items-center">
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
// Textos A, B e C (alternam a cada envio: A → B → C → A)
// ---------------------------------------------------------------------
const LETTERS = ["a", "b", "c"] as const;

function TemplatesEditor({ initial, businessName }: { initial: (string | null)[]; businessName: string }) {
  const [texts, setTexts] = useState<string[]>(() => DEFAULT_TEMPLATES.map((d, i) => initial[i] || d));
  const [pending, start] = useTransition();
  const refs = [useRef<HTMLTextAreaElement>(null), useRef<HTMLTextAreaElement>(null), useRef<HTMLTextAreaElement>(null)];

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
      const [a, b, c] = texts.map((t, i) => (t.trim() === DEFAULT_TEMPLATES[i].trim() ? "" : t));
      const r = await saveWhatsappTemplates(a, b, c);
      if (!r) return;
      if (r.ok) toast.success("Textos salvos");
      else toast.error(r.error);
    });
  }

  return (
    <div className="space-y-5">
      <div>
        <p className="font-semibold">Textos do lembrete</p>
        <p className="text-sm text-muted-foreground">Os três textos se alternam para a mensagem não ser sempre igual.</p>
      </div>

      {texts.map((t, i) => {
        const letter = LETTERS[i];
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
