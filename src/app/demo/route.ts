// GET /demo → entra na conta de demonstração (somente leitura) e abre o painel.
// A senha fica só no servidor (DEMO_EMAIL / DEMO_PASSWORD, sem NEXT_PUBLIC_).
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const email = process.env.DEMO_EMAIL;
  const password = process.env.DEMO_PASSWORD;
  const back = new URL("/?demo=indisponivel", request.url);

  if (!email || !password) return NextResponse.redirect(back);

  const supabase = createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return NextResponse.redirect(back);

  return NextResponse.redirect(new URL("/admin", request.url));
}