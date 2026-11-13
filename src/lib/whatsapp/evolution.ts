// Implementação Evolution API v2 (self-hosted) da camada de envio. Só no servidor.
// Conferido no código da v2.3.7 (src/api/routes/instance.router.ts e
// sendMessage.router.ts; src/api/guards/auth.guard.ts):
//   POST   /instance/create                    (chave GLOBAL)
//   GET    /instance/connect/{name}            → { base64, code, count } ou estado "open"
//   GET    /instance/connectionState/{name}    → { instance: { state: open|connecting|close } }
//   GET    /instance/fetchInstances?instanceName=  → [{ ownerJid, ... }]
//   POST   /message/sendText/{name}            { number, text }
//   DELETE /instance/logout/{name}  ·  DELETE /instance/delete/{name}
// Cabeçalho "apikey": a chave global só cria/apaga; o resto usa o token da
// própria instância (o guard aceita o token da instância nas rotas /{name}).
// Envs: EVOLUTION_API_URL e EVOLUTION_API_KEY. Nada daqui vai para logs.
import type { QrResult, SendResult, SimpleResult, StatusResult, WhatsAppProvider } from "./provider";
import { phoneFromJid, toWhatsappNumber } from "./phone";

if (typeof window !== "undefined") throw new Error("lib/whatsapp/evolution só roda no servidor");

const TIMEOUT_MS = 10_000;
const CREATE_TIMEOUT_MS = 20_000; // o create com qrcode espera ~5 s pelo QR

type Raw =
  | { kind: "ok"; status: number; body: unknown }
  | { kind: "http"; status: number; text: string }
  | { kind: "timeout" }
  | { kind: "network" }
  | { kind: "config" };

function baseUrl() {
  const url = (process.env.EVOLUTION_API_URL ?? "").trim().replace(/\/+$/, "");
  return /^https?:\/\//.test(url) ? url : null;
}

export const evolutionConfigured = () => !!baseUrl() && !!process.env.EVOLUTION_API_KEY;

/** Uma chamada, sem nova tentativa (quem decide repetir é a fila) */
async function call(
  path: string,
  key: string | undefined,
  init?: { method?: "GET" | "POST" | "DELETE"; body?: unknown; timeoutMs?: number }
): Promise<Raw> {
  const base = baseUrl();
  if (!base || !key) return { kind: "config" };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), init?.timeoutMs ?? TIMEOUT_MS);
  try {
    const res = await fetch(`${base}${path}`, {
      method: init?.method ?? "GET",
      headers: { "Content-Type": "application/json", apikey: key },
      body: init?.body ? JSON.stringify(init.body) : undefined,
      cache: "no-store",
      signal: ctrl.signal,
    });
    const text = await res.text();
    if (!res.ok) return { kind: "http", status: res.status, text };
    try {
      return { kind: "ok", status: res.status, body: JSON.parse(text) ?? {} };
    } catch {
      return { kind: "ok", status: res.status, body: {} };
    }
  } catch (e) {
    return (e as Error)?.name === "AbortError" ? { kind: "timeout" } : { kind: "network" };
  } finally {
    clearTimeout(timer);
  }
}

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const seg = (name: string) => `/${encodeURIComponent(name)}`;

/** Motivo para falhas que não são de envio */
function failReason(r: Exclude<Raw, { kind: "ok" }>): string {
  if (r.kind === "timeout") return "TIMEOUT";
  if (r.kind === "network") return "REDE";
  if (r.kind === "config") return "NAO_CONFIGURADO";
  if (r.status === 401 || r.status === 403) return "NAO_AUTORIZADO";
  if (r.status === 404 || /does not exist|not found/i.test(r.text)) return "INEXISTENTE";
  return r.status >= 500 ? "ERRO_PROVEDOR" : "RECUSADO";
}

const looksDisconnected = (t: string) => /connection closed|not connected|disconnected|desconect/i.test(t);

/** Extrai o QR (data URL) da resposta do connect/create */
function qrFrom(body: unknown): QrResult | null {
  const b = rec(body);
  const inst = rec(b.instance);
  if (inst.state === "open" || inst.status === "open") return { ok: true, connected: true };
  if (b.error === true) return { ok: false, reason: "RECUSADO" };
  const qr = rec(b.qrcode).base64 ? rec(b.qrcode) : b; // create devolve em qrcode; connect devolve direto
  const base64 = qr.base64;
  if (typeof base64 === "string" && base64.length > 50) {
    return { ok: true, image: base64.startsWith("data:image/") ? base64 : `data:image/png;base64,${base64}` };
  }
  return null;
}

// ---------------------------------------------------------------------
// Chave global: criar e apagar instâncias
// ---------------------------------------------------------------------

/** Cria a instância com o token gerado pela Genix. Devolve o primeiro QR, se veio. */
export async function createEvolutionInstance(name: string, token: string): Promise<QrResult> {
  const body = { instanceName: name, token, integration: "WHATSAPP-BAILEYS", qrcode: true };
  let r = await call("/instance/create", process.env.EVOLUTION_API_KEY, { method: "POST", body, timeoutMs: CREATE_TIMEOUT_MS });

  // nome já existe no servidor (sobra de uma tentativa anterior): apaga e cria de novo, uma vez
  if (r.kind === "http" && r.status < 500 && /already in use|já está em uso/i.test(r.text)) {
    await call(`/instance/delete${seg(name)}`, process.env.EVOLUTION_API_KEY, { method: "DELETE" });
    r = await call("/instance/create", process.env.EVOLUTION_API_KEY, { method: "POST", body, timeoutMs: CREATE_TIMEOUT_MS });
  }
  if (r.kind !== "ok") return { ok: false, reason: failReason(r) };
  return qrFrom(r.body) ?? { ok: false, reason: "AGUARDANDO" };
}

export async function deleteEvolutionInstance(name: string): Promise<SimpleResult> {
  const r = await call(`/instance/delete${seg(name)}`, process.env.EVOLUTION_API_KEY, { method: "DELETE" });
  if (r.kind === "ok" || (r.kind === "http" && failReason(r) === "INEXISTENTE")) return { ok: true };
  return { ok: false, reason: failReason(r) };
}

// ---------------------------------------------------------------------
// Token da instância: QR, estado, número, envio, logout
// ---------------------------------------------------------------------
export function createEvolutionProvider(c: { instanceName: string; token: string }): WhatsAppProvider {
  const name = seg(c.instanceName);

  return {
    async sendText(phone, text, country): Promise<SendResult> {
      const r = await call(`/message/sendText${name}`, c.token, {
        method: "POST",
        body: { number: toWhatsappNumber(phone, country), text },
      });

      if (r.kind === "timeout") return { ok: false, reason: "TIMEOUT", transient: true, disconnected: false };
      if (r.kind === "network") return { ok: false, reason: "REDE", transient: true, disconnected: false };
      if (r.kind === "config") return { ok: false, reason: "ERRO_PROVEDOR", transient: true, disconnected: false };
      if (r.kind === "http") {
        // token recusado ou instância sumiu: tratar como desconectado (o agendamento fica na fila)
        if (r.status === 401 || r.status === 403 || r.status === 404) {
          return { ok: false, reason: "DESCONECTADO", transient: false, disconnected: true };
        }
        if (looksDisconnected(r.text)) return { ok: false, reason: "DESCONECTADO", transient: false, disconnected: true };
        if (/"exists"\s*:\s*false|not on whatsapp|invalid number|jid/i.test(r.text)) {
          return { ok: false, reason: "NUMERO_INVALIDO", transient: false, disconnected: false };
        }
        if (r.status >= 500) return { ok: false, reason: "ERRO_PROVEDOR", transient: true, disconnected: false };
        return { ok: false, reason: "RECUSADO", transient: false, disconnected: false };
      }

      const id = rec(rec(r.body).key).id;
      return { ok: true, messageId: typeof id === "string" ? id : null };
    },

    async status(): Promise<StatusResult> {
      const r = await call(`/instance/connectionState${name}`, c.token);
      if (r.kind !== "ok") {
        const reason = failReason(r);
        // instância inexistente ou token recusado: está desconectada
        if (reason === "INEXISTENTE" || reason === "NAO_AUTORIZADO") return { ok: true, connected: false };
        return { ok: false, reason };
      }
      return { ok: true, connected: rec(rec(r.body).instance).state === "open" };
    },

    async qrCode(): Promise<QrResult> {
      const r = await call(`/instance/connect${name}`, c.token);
      if (r.kind !== "ok") return { ok: false, reason: failReason(r) };
      return qrFrom(r.body) ?? { ok: false, reason: "AGUARDANDO" };
    },

    async ownerPhone() {
      const r = await call(`/instance/fetchInstances?instanceName=${encodeURIComponent(c.instanceName)}`, c.token);
      if (r.kind !== "ok") return null;
      const list = Array.isArray(r.body) ? r.body : [r.body];
      const first = rec(list[0]);
      return phoneFromJid(first.ownerJid ?? rec(first.instance).owner ?? first.number);
    },

    async logout(): Promise<SimpleResult> {
      const r = await call(`/instance/logout${name}`, c.token, { method: "DELETE" });
      if (r.kind === "ok") return { ok: true };
      // já estava desconectada (400 "is not connected") ou não existe: o efeito é o mesmo
      if (r.kind === "http" && (r.status === 400 || r.status === 404)) return { ok: true };
      return { ok: false, reason: failReason(r) };
    },
  };
}
