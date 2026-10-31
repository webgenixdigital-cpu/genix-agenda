import Link from "next/link";
import { BrandLogo } from "@/components/brand-logo";
import { Star } from "lucide-react";
import { LoginForm } from "./login-form";

export const metadata = { title: "Entrar | Genix Agenda" };

type Props = { searchParams: { next?: string } };

export default function LoginPage({ searchParams }: Props) {
  // só aceita redirecionar para dentro do painel
  const next = searchParams.next?.startsWith("/admin") ? searchParams.next : "/admin";

  return (
    <div className="grid min-h-svh lg:grid-cols-2">
      {/* ---------- PAINEL INSTITUCIONAL ---------- */}
      <aside className="relative hidden flex-col justify-between bg-foreground p-12 text-background lg:flex">
        <Link href="/" className="flex w-fit items-center" data-testid="link-home-aside">
          <BrandLogo tone="escuro" />
        </Link>

        <div className="max-w-md">
          <h1 className="text-5xl leading-[1.08]">Sua agenda cheia, sem viver no WhatsApp.</h1>
          <p className="mt-5 text-lg text-stone-300">
            Clientes agendam pela sua vitrine a qualquer hora. Você confirma com um toque.
          </p>

          <figure className="mt-12 rounded-2xl border border-white/10 bg-white/5 p-6">
            <div className="flex gap-0.5">
              {Array.from({ length: 5 }).map((_, i) => (
                <Star key={i} className="h-4 w-4 fill-[#F2C078] text-[#F2C078]" />
              ))}
            </div>
            <blockquote className="mt-3 leading-relaxed text-stone-200">
              Parei de perder horário por mensagem esquecida. Metade da agenda agora chega pela vitrine.
            </blockquote>
            <figcaption className="mt-3 text-sm text-stone-400">Renata, Salão Lumina Belle</figcaption>
          </figure>
        </div>

        <p className="text-sm text-stone-500">Genix Sistemas Integrativos</p>
      </aside>

      {/* ---------- FORMULÁRIO ---------- */}
      <main className="flex items-center justify-center p-6 md:p-12">
        <div className="w-full max-w-sm">
          <Link href="/" className="mb-10 flex min-h-11 w-fit items-center lg:hidden" data-testid="link-home">
            <BrandLogo priority />
          </Link>
          <h2 className="text-3xl">Entrar no painel</h2>
                    <p className="mt-2 text-muted-foreground">
            Use o e-mail cadastrado do seu espaço. Ainda não tem conta?{" "}
            <Link href="/cadastro" className="font-semibold text-primary underline">Criar conta grátis</Link>
          </p>
          <LoginForm next={next} />
        </div>
      </main>
    </div>
  );
}