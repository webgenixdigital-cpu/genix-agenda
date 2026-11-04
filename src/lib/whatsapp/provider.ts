// Camada de envio de WhatsApp (só no servidor).
// Implementações: Evolution API (self-hosted, padrão das conexões novas com
// WHATSAPP_PROVIDER=evolution) e Z-API (alternativa). A API oficial entra
// depois como outra implementação desta mesma interface.
// Cada linha de whatsapp_instances guarda o próprio provider: trocar a env
// só muda o que é usado nas conexões NOVAS.
// Nunca importe este arquivo num componente "use client".
import { createEvolutionProvider, evolutionConfigured } from "./evolution";
import { createZapiProvider } from "./zapi";

export type SendResult =
  | { ok: true; messageId: string | null }
  /** transient: timeout, erro de rede ou 5xx (pode tentar 1 vez mais tarde) */
  | { ok: false; reason: string; transient: boolean; disconnected: boolean };

export type StatusResult = { ok: true; connected: boolean } | { ok: false; reason: string };

/** reason "AGUARDANDO": o servidor ainda está gerando o QR (tente em instantes) */
export type QrResult = { ok: true; image: string } | { ok: true; connected: true } | { ok: false; reason: string };

export type SimpleResult = { ok: true } | { ok: false; reason: string };

export interface WhatsAppProvider {
  sendText(phone: string, text: string): Promise<SendResult>;
  status(): Promise<StatusResult>;
  /** QR Code para conectar o número (data URL de imagem) */
  qrCode(): Promise<QrResult>;
  /** número conectado (formato do normalize_phone), quando o provedor informa */
  ownerPhone?(): Promise<string | null>;
  /** desconecta o número (mantém a instância) */
  logout?(): Promise<SimpleResult>;
}

export type ProviderName = "zapi" | "evolution";

/** Provider das conexões novas (WHATSAPP_PROVIDER). Sem a env, vale a Z-API (comportamento antigo). */
export function defaultProviderName(): ProviderName {
  return process.env.WHATSAPP_PROVIDER === "evolution" ? "evolution" : "zapi";
}

/** Linha de whatsapp_instances (lida com o client de serviço) */
export type InstanceRow = {
  provider: string;
  instance_id: string | null;
  instance_name?: string | null;
  token: string | null;
  client_token: string | null;
};

export const INSTANCE_COLUMNS = "provider, instance_id, instance_name, token, client_token";

export function getProvider(row: InstanceRow): WhatsAppProvider | null {
  switch (row.provider) {
    case "zapi":
      if (!row.instance_id || !row.token || !row.client_token) return null;
      return createZapiProvider({ instanceId: row.instance_id, token: row.token, clientToken: row.client_token });
    case "evolution":
      if (!row.instance_name || !row.token || !evolutionConfigured()) return null;
      return createEvolutionProvider({ instanceName: row.instance_name, token: row.token });
    default:
      return null;
  }
}
