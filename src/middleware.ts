import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { mainOrigin, subdomainOf } from "@/lib/vitrine-url";

export async function middleware(request: NextRequest) {
  const host = request.headers.get("host");
  const sub = subdomainOf(host);
  if (sub) return vitrineSubdomain(request, sub, host);
  return updateSession(request);
}

/**
 * <slug>.genixagenda.com.br (local: <slug>.localhost:3000) → vitrine, sem sessão nem cookie.
 * - "/" e "/avaliar/<id>": rewrite para /v/<slug>... (endereço fica na barra). Vale para
 *   qualquer método: o POST das server actions (cabeçalho Next-Action) também vai para /v/<slug>.
 * - /_next, /api e arquivos (robots.txt etc.): seguem sem rewrite.
 * - qualquer outra rota (inclusive /v/...), ou subdomínio reservado/inválido: 308 para o
 *   domínio principal (uma vitrine nunca aparece no subdomínio de outra).
 */
function vitrineSubdomain(request: NextRequest, sub: string, host: string | null) {
  const { pathname, search } = request.nextUrl;
  const toMain = () => NextResponse.redirect(`${mainOrigin(host)}${pathname}${search}`, 308);

  if (sub === "reserved") return toMain();

  if (pathname === "/" || /^\/avaliar\/[^/]+\/?$/.test(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = pathname === "/" ? `/v/${sub}` : `/v/${sub}${pathname.replace(/\/$/, "")}`;
    return NextResponse.rewrite(url);
  }

  if (/^\/(_next|api)\//.test(pathname) || /\.[a-z0-9]+$/i.test(pathname)) return NextResponse.next();

  return toMain();
}

export const config = {
  matcher: [
    // Roda em tudo, exceto arquivos estáticos e imagens
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
