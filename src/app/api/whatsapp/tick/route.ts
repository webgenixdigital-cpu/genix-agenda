// Relógio dos lembretes automáticos no WhatsApp.
// Chamado a cada 5 min pelo pg_cron do Supabase (supabase/manual/whatsapp-cron.sql)
// com o cabeçalho Authorization: Bearer <CRON_SECRET>.
import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { runWhatsappTick } from "@/lib/whatsapp/tick";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// 60 s é o máximo do plano Hobby da Vercel (também vale no Pro)
export const maxDuration = 60;

// orçamento dentro dos 60 s: cada chamada à Z-API tem timeout de 10 s
const START_NEW_MS = 30_000; // depois disso, não começa espaço novo
const SEND_MS = 38_000; // depois disso, não reserva envio (status + envio + registro cabem no resto)

function authorized(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const got = Buffer.from(req.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  return got.length === want.length && timingSafeEqual(got, want);
}

export async function POST(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // trava geral: sem WHATSAPP_SEND_ENABLED=1 nada é enviado (local usa o mesmo banco da produção)
  if (process.env.WHATSAPP_SEND_ENABLED !== "1") {
    return NextResponse.json({ ok: true, skipped: "WHATSAPP_SEND_ENABLED desligado" });
  }

  const started = Date.now();
  try {
    const summary = await runWhatsappTick({ startNewBefore: started + START_NEW_MS, sendBefore: started + SEND_MS });
    return NextResponse.json({ ok: true, ms: Date.now() - started, ...summary });
  } catch (e) {
    console.error("[whatsapp-tick]", (e as Error).message);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
