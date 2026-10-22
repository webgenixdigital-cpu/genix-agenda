// GET /auth/confirm?token_hash=...&type=recovery|email
// Valida o link de uso único enviado por e-mail e redireciona.
// Funciona mesmo se o link for aberto em outro aparelho/navegador.
import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;

  const fail = (motivo: string) =>
    NextResponse.redirect(new URL(`/esqueci-senha?erro=${motivo}`, request.url));

  if (!tokenHash || !type) return fail("link-invalido");

  const supabase = createClient();
  const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
  if (error) return fail("link-expirado");

  // Redefinição de senha → tela para criar a senha nova
  if (type === "recovery") {
    return NextResponse.redirect(new URL("/redefinir-senha", request.url));
  }

  // Convite da equipe → e-mail já comprovado + criar a primeira senha
  if (type === "invite") {
    await supabase.auth.updateUser({ data: { email_verified_at: new Date().toISOString() } });
    return NextResponse.redirect(new URL("/redefinir-senha?novo=1", request.url));
  }

  // Confirmação de e-mail → marca como confirmado e abre o painel
  await supabase.auth.updateUser({ data: { email_verified_at: new Date().toISOString() } });
  return NextResponse.redirect(new URL("/admin?email=confirmado", request.url));
}
