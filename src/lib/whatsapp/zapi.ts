// Implementação Z-API da camada de envio (só no servidor).
// Docs: https://developer.z-api.io — cada instância tem id + token, e a conta
// da Genix tem um Client-Token (cabeçalho de segurança).
import type { QrResult, SendResult, StatusResult, WhatsAppProvider } from "./provider";

const BASE = "https://api.z-api.io/instances";
const TIMEOUT_MS = 10_000;

type Creds = { instanceId: string; token: string; clientToken: string };

type Raw =
  | { kind: "ok"; status: number; body: Record<string, unknown> }
  | { kind: "http"; status: number; text: string }
  | { kind: "timeout" }
  | { kind: "network" };

/** Uma chamada, sem nova tentativa (quem decide repetir é a fila) */
async function call(c: Creds, path: string, init?: { method: "GET" | "POST"; body?: unknown }): Promise<Raw> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE}/${encodeURIComponent(c.instanceId)}/token/${encodeURIComponent(c.token)}/${path}`, {
      method: init?.method ?? "GET",
      headers: { "Content-Type": "application/json", "Client-Token": c.clientToken },
      body: init?.body ? JSON.stringify(init.body) : undefined,
      cache: "no-store",
      signal: ctrl.signal,
    });
    const text = await res.text();
    if (!res.ok) return { kind: "http", status: res.status, text };
    try {
      return { kind: "ok", status: res.status, body: (JSON.parse(text) ?? {}) as Record<string, unknown> };
    } catch {
      return { kind: "ok", status: res.status, body: {} };
    }
  } catch (e) {
    return (e as Error)?.name === "AbortError" ? { kind: "timeout" } : { kind: "network" };
  } finally {
    clearTimeout(timer);
  }
}

const looksDisconnected = (t: string) => /not connected|disconnect|desconect|qr ?code/i.test(t);

export function createZapiProvider(c: Creds): WhatsAppProvider {
  return {
    async sendText(phone, text): Promise<SendResult> {
      // telefone do banco: só dígitos, sem o 55
      const r = await call(c, "send-text", { method: "POST", body: { phone: `55${phone}`, message: text } });

      if (r.kind === "timeout") return { ok: false, reason: "TIMEOUT", transient: true, disconnected: false };
      if (r.kind === "network") return { ok: false, reason: "REDE", transient: true, disconnected: false };
      if (r.kind === "http") {
        if (r.status >= 500) return { ok: false, reason: "ERRO_PROVEDOR", transient: true, disconnected: false };
        if (looksDisconnected(r.text)) return { ok: false, reason: "DESCONECTADO", transient: false, disconnected: true };
        if (/phone|number|numero|número/i.test(r.text)) {
          return { ok: false, reason: "NUMERO_INVALIDO", transient: false, disconnected: false };
        }
        return { ok: false, reason: "RECUSADO", transient: false, disconnected: false };
      }

      const err = typeof r.body.error === "string" ? r.body.error : null;
      if (err) {
        return looksDisconnected(err)
          ? { ok: false, reason: "DESCONECTADO", transient: false, disconnected: true }
          : { ok: false, reason: "RECUSADO", transient: false, disconnected: false };
      }
      const id = r.body.messageId ?? r.body.zaapId ?? r.body.id;
      return { ok: true, messageId: typeof id === "string" ? id : null };
    },

    async status(): Promise<StatusResult> {
      const r = await call(c, "status");
      if (r.kind === "timeout") return { ok: false, reason: "TIMEOUT" };
      if (r.kind === "network") return { ok: false, reason: "REDE" };
      if (r.kind === "http") return { ok: false, reason: r.status >= 500 ? "ERRO_PROVEDOR" : "RECUSADO" };
      return { ok: true, connected: r.body.connected === true };
    },

    async qrCode(): Promise<QrResult> {
      const r = await call(c, "qr-code/image");
      if (r.kind === "timeout") return { ok: false, reason: "TIMEOUT" };
      if (r.kind === "network") return { ok: false, reason: "REDE" };
      if (r.kind === "http") return { ok: false, reason: r.status >= 500 ? "ERRO_PROVEDOR" : "RECUSADO" };
      if (r.body.connected === true) return { ok: true, connected: true };
      const value = r.body.value;
      if (typeof value === "string" && value.startsWith("data:image/")) return { ok: true, image: value };
      return { ok: false, reason: "RECUSADO" };
    },
  };
}
