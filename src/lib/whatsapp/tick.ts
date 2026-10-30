// Relógio dos lembretes automáticos (chamado a cada 5 min pela rota
// /api/whatsapp/tick). Só no servidor: usa o client de serviço.
// Regras de janela, ritmo, fila e reconferência ficam no banco
// (next_auto_reminder / claim_auto_reminder / finish_auto_reminder).
import { createAdminClient } from "@/lib/supabase/admin";
import { getProvider, type InstanceRow } from "./provider";
import { DEFAULT_TEMPLATES, renderTemplate } from "./templates";

const STATUS_TTL_MS = 30 * 60_000; // status() só se a última conferência tem > 30 min (ou há lembrete pronto)
const CONCURRENCY = 5;

type Candidate = { business_id: string; status: string; status_checked_at: string | null; has_due: boolean };

type Claim = {
  send_id: string;
  variant: 0 | 1;
  template: string | null;
  phone: string;
  customer_name: string;
  service_name: string;
  professional_name: string;
  booking_date: string;
  start_time: string;
  business_name: string;
};

export type TickSummary = {
  expired: number;
  checked: number;
  sent: number;
  failed: number;
  /** espaços deixados para o próximo tick por falta de tempo */
  deferred: number;
};

/**
 * @param startNewBefore horário (ms) limite para começar um espaço novo
 * @param sendBefore     horário (ms) limite para reservar e enviar
 */
export async function runWhatsappTick(opts: { startNewBefore: number; sendBefore: number }): Promise<TickSummary> {
  const db = createAdminClient();
  const summary: TickSummary = { expired: 0, checked: 0, sent: 0, failed: 0, deferred: 0 };

  const { data: expired } = await db.rpc("expire_stale_auto_reminders");
  summary.expired = Number(expired ?? 0);

  const { data, error } = await db.rpc("whatsapp_tick_candidates");
  if (error) throw new Error(`whatsapp_tick_candidates: ${error.message}`);

  const now = Date.now();
  const queue = ((data ?? []) as Candidate[]).filter(
    (c) => c.has_due || !c.status_checked_at || now - new Date(c.status_checked_at).getTime() > STATUS_TTL_MS
  );

  async function processOne(c: Candidate) {
    const { data: inst } = await db
      .from("whatsapp_instances")
      .select("provider, instance_id, token, client_token")
      .eq("business_id", c.business_id)
      .maybeSingle();
    const provider = inst ? getProvider(inst as InstanceRow) : null;
    if (!provider) return;

    // 1) conexão da instância
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

    // 2) reserva (o banco reconfere status, plano, janela, ritmo e opt-out)
    const { data: claimed, error: claimError } = await db.rpc("claim_auto_reminder", { p_business: c.business_id });
    if (claimError || !claimed) return;
    const cl = claimed as Claim;

    const text = renderTemplate(cl.template || DEFAULT_TEMPLATES[cl.variant], {
      customerName: cl.customer_name,
      serviceName: cl.service_name,
      professionalName: cl.professional_name,
      date: cl.booking_date,
      time: cl.start_time,
      businessName: cl.business_name,
    });

    // 3) envio (uma chamada; nada de repetir em loop)
    const res = await provider.sendText(cl.phone, text);
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
      // desconectou: pausa o espaço até reconectar
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
