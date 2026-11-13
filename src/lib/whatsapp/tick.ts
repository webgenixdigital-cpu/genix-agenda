// Relógio das mensagens automáticas (chamado a cada minuto pela rota
// /api/whatsapp/tick). Só no servidor: usa o client de serviço.
// Regras de janela, ritmo, fila e reconferência ficam no banco.
//
// Dois caminhos (chave WHATSAPP_QUEUE_V2, lib/whatsapp/queue.ts):
//   novo   (=1): whatsapp_queue_refresh → whatsapp_tick_candidates_v2 → claim_auto_message
//                (confirmação, antes do horário, véspera e aniversário — 42)
//   antigo (≠1): whatsapp_tick_candidates → claim_auto_reminder (só véspera)
// Os dois terminam em finish_auto_reminder.
import { createAdminClient } from "@/lib/supabase/admin";
import { getProvider, INSTANCE_COLUMNS, type InstanceRow } from "./provider";
import { defaultTemplateFor, renderTemplate, type MessageKind } from "./templates";
import { queueV2Enabled } from "./queue";

const STATUS_TTL_MS = 30 * 60_000; // status() só se a última conferência tem > 30 min (ou há mensagem pronta)
const CONCURRENCY = 5;

type Candidate = { business_id: string; status: string; status_checked_at: string | null; has_due: boolean };

type Claim = {
  send_id: string;
  /** só no caminho novo; o antigo é sempre véspera */
  kind?: MessageKind;
  variant: 0 | 1 | 2;
  template: string | null;
  phone: string;
  /** código do país (45); ausente = Brasil */
  phone_country?: string | null;
  customer_name: string;
  /** null no aniversário (sem agendamento) */
  service_name: string | null;
  professional_name: string | null;
  booking_date: string | null;
  start_time: string | null;
  business_name: string;
};

export type TickSummary = {
  /** caminho usado neste tick */
  queue: "v2" | "v1";
  expired: number;
  checked: number;
  sent: number;
  failed: number;
  /** espaços deixados para o próximo tick por falta de tempo */
  deferred: number;
  /** só no caminho novo: resultado do whatsapp_queue_refresh */
  queued?: number;
  queueExpired?: number;
  queueSkipped?: number;
};

/**
 * @param startNewBefore horário (ms) limite para começar um espaço novo
 * @param sendBefore     horário (ms) limite para reservar e enviar
 */
export async function runWhatsappTick(opts: { startNewBefore: number; sendBefore: number }): Promise<TickSummary> {
  const db = createAdminClient();
  const v2 = queueV2Enabled();
  const summary: TickSummary = { queue: v2 ? "v2" : "v1", expired: 0, checked: 0, sent: 0, failed: 0, deferred: 0 };

  const { data: expired } = await db.rpc("expire_stale_auto_reminders");
  summary.expired = Number(expired ?? 0);

  // fila nova: enfileira o que já pode sair e descarta o que perdeu a validade
  if (v2) {
    const { data: refreshed, error: refreshError } = await db.rpc("whatsapp_queue_refresh");
    if (refreshError) throw new Error(`whatsapp_queue_refresh: ${refreshError.message}`);
    const r = (refreshed ?? {}) as { enfileiradas?: number; expiradas?: number; descartadas?: number };
    summary.queued = Number(r.enfileiradas ?? 0);
    summary.queueExpired = Number(r.expiradas ?? 0);
    summary.queueSkipped = Number(r.descartadas ?? 0);
  }

  const { data, error } = await db.rpc(v2 ? "whatsapp_tick_candidates_v2" : "whatsapp_tick_candidates");
  if (error) throw new Error(`whatsapp_tick_candidates: ${error.message}`);

  const now = Date.now();
  const queue = ((data ?? []) as Candidate[]).filter(
    (c) => c.has_due || !c.status_checked_at || now - new Date(c.status_checked_at).getTime() > STATUS_TTL_MS
  );

  async function processOne(c: Candidate) {
    const { data: inst } = await db
      .from("whatsapp_instances")
      .select(INSTANCE_COLUMNS)
      .eq("business_id", c.business_id)
      .maybeSingle();
    const provider = inst ? getProvider(inst as InstanceRow) : null;
    if (!provider) return;

    // 1) conexão da instância: estado diferente de conectado ("open" na Evolution)
    //    marca "desconectado" e pula o espaço; as mensagens continuam na fila
    const st = await provider.status();
    summary.checked++;
    if (!st.ok) return; // não deu para conferir: não envia neste tick
    await db
      .from("whatsapp_instances")
      .update({ status: st.connected ? "connected" : "disconnected", status_checked_at: new Date().toISOString() })
      .eq("business_id", c.business_id);
    if (!st.connected || !c.has_due) return;
    if (Date.now() > opts.sendBefore) {
      summary.deferred++;
      return;
    }

    // 2) reserva (o banco reconfere status, plano, janela, ritmo, opt-out e validade)
    const { data: claimed, error: claimError } = await db.rpc(v2 ? "claim_auto_message" : "claim_auto_reminder", {
      p_business: c.business_id,
    });
    if (claimError || !claimed) return;
    const cl = claimed as Claim;
    const kind: MessageKind = cl.kind ?? "eve";

    const text = renderTemplate(cl.template || defaultTemplateFor(kind, cl.variant), {
      customerName: cl.customer_name,
      serviceName: cl.service_name ?? "",
      professionalName: cl.professional_name ?? "",
      date: cl.booking_date ?? "",
      time: cl.start_time ?? "",
      businessName: cl.business_name,
    });

    // 3) envio (uma chamada; nada de repetir em loop)
    const res = await provider.sendText(cl.phone, text, cl.phone_country);
    await db.rpc("finish_auto_reminder", {
      p_send: cl.send_id,
      p_ok: res.ok,
      p_reason: res.ok ? null : res.reason,
      p_retryable: res.ok ? false : res.transient,
      p_message_id: res.ok ? res.messageId : null,
    });

    if (res.ok) summary.sent++;
    else {
      summary.failed++;
      // desconectou: o banco devolve a mensagem para a fila e o espaço fica
      // pausado até reconectar; nada de nova tentativa neste tick
      if (res.disconnected) {
        await db
          .from("whatsapp_instances")
          .update({ status: "disconnected", status_checked_at: new Date().toISOString() })
          .eq("business_id", c.business_id);
      }
    }
  }

  // até CONCURRENCY espaços em paralelo; sem tempo, o resto fica para o próximo tick
  let next = 0;
  async function worker() {
    while (next < queue.length) {
      if (Date.now() > opts.startNewBefore) {
        summary.deferred += queue.length - next;
        next = queue.length;
        return;
      }
      const c = queue[next++];
      try {
        await processOne(c);
      } catch (e) {
        console.error("[whatsapp-tick]", c.business_id, (e as Error).message);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));

  return summary;
}
