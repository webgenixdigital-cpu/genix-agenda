import Link from "next/link";
import { CalendarHeart } from "lucide-react";
import { Button } from "@/components/ui/button";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-border/80 bg-white/85 backdrop-blur-xl backdrop-saturate-150">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-2 px-4 md:px-6">
        <Link href="/" className="flex shrink-0 items-center gap-2" data-testid="link-home">
          <span className="grid h-9 w-9 place-items-center rounded-full bg-primary text-primary-foreground">
            <CalendarHeart className="h-5 w-5" />
          </span>
          <span className="font-heading text-xl tracking-tight">Genix Agenda</span>
        </Link>
        <nav className="flex items-center gap-1 sm:gap-2" aria-label="Principal">
          {/* no celular, rótulos curtos para caber ao lado do logo */}
          <Button asChild variant="ghost" size="sm" className="h-11 px-3" data-testid="link-encontrar-espaco">
            <Link href="/espacos">
              <span className="sm:hidden">Espaços</span>
              <span className="hidden sm:inline">Encontrar um espaço</span>
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm" className="h-11 px-3" data-testid="btn-area-profissional">
            <Link href="/admin/login">
              <span className="sm:hidden">Entrar</span>
              <span className="hidden sm:inline">Área do profissional</span>
            </Link>
          </Button>
        </nav>
      </div>
    </header>
  );
}
