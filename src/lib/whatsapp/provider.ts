// Camada de envio de WhatsApp (só no servidor).
// Hoje a única implementação é a Z-API (não oficial); a API oficial entra
// depois como outra implementação desta mesma interface.
// Nunca importe este arquivo num componente "use client".
import { createZapiProvider } from "./zapi";

export type SendResult =
  | { ok: true; messageId: string | null }
  /** transient: timeout, erro de rede ou 5xx (pode tentar 1 vez mais tarde) */
  | { ok: false; reason: string; transient: boolean; disconnected: boolean };

export type StatusResult = { ok: true; connected: boolean } | { ok: false; reason: string };

export type QrResult = { ok: true; image: string } | { ok: true; connected: true } | { ok: false; reason: string };

export interface WhatsAppProvider {
  sendText(phone: string, text: string): Promise<SendResult>;
  status(): Promise<StatusResult>;
  /** QR Code para conectar o número (data URL de imagem) */
  qrCode(): Promise<QrResult>;
}

/** Linha de whatsapp_instances (lida com o client de serviço) */
export type InstanceRow = {
  provider: string;
  instance_id: string | null;
  token: string | null;
  client_token: string | null;
};

export function getProvider(row: InstanceRow): WhatsAppProvider | null {
  if (!row.instance_id || !row.token || !row.client_token) return null;
  switch (row.provider) {
    case "zapi":
      return createZapiProvider({ instanceId: row.instance_id, token: row.token, clientToken: row.client_token });
    default:
      return null;
  }
}
