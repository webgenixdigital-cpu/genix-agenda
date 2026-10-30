// GET /demo/sair?para=cadastro → encerra a sessão da demonstração e redireciona.
// Destinos permitidos: cadastro (padrão: página principal "/").
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const DESTINOS: Record<string, string> = {
  cadastro: "/cadastro",
  profissional: "/", // nome antigo, mantido para links já existentes
};

export async function GET(request: NextRequest) {
  const para = request.nextUrl.searchParams.get("para") ?? "profissional";
  const destino = DESTINOS[para] ?? "/";

  const supabase = createClient();
  await supabase.auth.signOut();

  return NextResponse.redirect(new URL(destino, request.url));
}