// Nix (assistente) — Fase 1: dúvidas de uso, sem dados do espaço.
// Acesso: Equipe pago ou últimos 3 dias do teste (lib/agente/access.ts + agent_access no banco, 60).
// Cota diária: ai_usage_hit (60). Chave e modelo só no servidor (GEMINI_API_KEY, GEMINI_MODEL).
import { ApiError, GoogleGenAI, type Content } from "@google/genai";
import { NextResponse } from "next/server";
import { getAdminContext } from "@/lib/admin";
import { agentAccess, agentEnabled } from "@/lib/agente/access";
import { montarInstrucao } from "@/lib/agente/instrucao";
import { todayInZone } from "@/lib/dates";
import { getPlanContext } from "@/lib/plan";
import { normalizePlans, PLAN_COLUMNS } from "@/lib/plans-public";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/** Modelo Flash estável (não usar alias -latest); trocar pela variável sem mexer no código */
const DEFAULT_MODEL = "gemini-3.8-flash";

const MAX_MESSAGE = 1000;
const MAX_TURN = 2000;
/** trocas (pergunta + resposta) anteriores enviadas ao modelo */
const MAX_HISTORY = 10;

type Turn = { role: "user" | "model"; text: string };

const fail = (status: number, error: string) => NextResponse.json({ error }, { status });

function parseBody(raw: unknown): { message: string; history: Turn[] } | null {
  if (!raw || typeof raw !== "object") return null;
  const { message, history } = raw as { message?: unknown; history?: unknown };
  if (typeof message !== "string") return null;
  const msg = message.trim();
  if (!msg || msg.length > MAX_MESSAGE) return null;
  if (history !== undefined && !Array.isArray(history)) return null;
  const turns = (history ?? []) as unknown[];
  if (turns.length > MAX_HISTORY * 2) return null;
  const clean: Turn[] = [];
  for (const t of turns) {
    if (!t || typeof t !== "object") return null;
    const { role, text } = t as { role?: unknown; text?: unknown };
    if ((role !== "user" && role !== "model") || typeof text !== "string" || text.length > MAX_TURN) return null;
    if (text.trim()) clean.push({ role, text });
  }
  return { message: msg, history: clean };
}

export async function POST(req: Request) {
  if (!agentEnabled()) return fail(503, "A Nix está desligada no momento.");

  const ctx = await getAdminContext();
  const plan = await getPlanContext(ctx.business.id);
  const access = agentAccess(ctx, plan);
  if (access.kind !== "pago" && access.kind !== "teste") {
    return fail(403, "A Nix está disponível no plano Equipe.");
  }

  let body: ReturnType<typeof parseBody> = null;
  try {
    body = parseBody(await req.json());
  } catch {
    body = null;
  }
  if (!body) return fail(400, `Escreva uma pergunta de até ${MAX_MESSAGE} caracteres.`);

  // cota do dia (e conferência do acesso) no banco
  const supabase = createClient();
  const { data: left, error: hitError } = await supabase.rpc("ai_usage_hit", { p_business: ctx.business.id });
  if (hitError) {
    if (hitError.message.includes("COTA_ESGOTADA"))
      return fail(429, "A Nix já respondeu o máximo de perguntas de hoje. Amanhã ela volta!");
    if (hitError.message.includes("PLANO_EQUIPE")) return fail(403, "A Nix está disponível no plano Equipe.");
    if (hitError.message.includes("SEM_PERMISSAO")) return fail(403, "Seu acesso não inclui a Nix.");
    return fail(503, "Não foi possível falar com a Nix agora. Tente de novo em instantes.");
  }

  const { data: planRows } = await supabase.from("plans").select(PLAN_COLUMNS).eq("active", true);
  const systemInstruction = montarInstrucao({
    businessName: ctx.business.name,
    today: todayInZone(ctx.business.timezone),
    role: ctx.role as "owner" | "reception",
    plan: plan.kind,
    plans: normalizePlans(planRows as Record<string, unknown>[] | null),
  });

  const contents: Content[] = [
    ...body.history.map((t) => ({ role: t.role, parts: [{ text: t.text }] })),
    { role: "user", parts: [{ text: body.message }] },
  ];

  // falha do Gemini não conta na cota do dia
  const refund = () => supabase.rpc("ai_usage_refund", { p_business: ctx.business.id }).then(() => undefined);

  try {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
    const res = await ai.models.generateContent({
      model: process.env.GEMINI_MODEL || DEFAULT_MODEL,
      contents,
      config: {
        systemInstruction,
        temperature: 0.3,
        maxOutputTokens: 1024,
        abortSignal: AbortSignal.timeout(45_000),
      },
    });

    const reply = res.text?.trim();
    const tokens = res.usageMetadata?.totalTokenCount ?? 0;
    if (tokens > 0) await supabase.rpc("ai_usage_tokens", { p_business: ctx.business.id, p_tokens: tokens });
    if (!reply) {
      await refund();
      return fail(502, "A Nix não conseguiu responder essa. Tente perguntar de outro jeito.");
    }

    return NextResponse.json({ reply, restantes: access.kind === "teste" ? (left as number) : null });
  } catch (e) {
    const status = e instanceof ApiError ? e.status : 0;
    console.error("[agente] gemini", status, e instanceof Error ? e.message : e);
    await refund();
    if (status === 429) return fail(429, "A Nix está recebendo muitas perguntas agora. Tente de novo em 1 minuto.");
    return fail(502, "A Nix não conseguiu responder agora. Tente de novo em instantes.");
  }
}
