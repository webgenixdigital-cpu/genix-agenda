import Link from "next/link";
import { BrandIcon, BrandLogo } from "@/components/brand-logo";
import { Button } from "@/components/ui/button";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-border/80 bg-white/85 backdrop-blur-xl backdrop-saturate-150">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-2 px-4 md:px-6">
        <Link href="/" className="flex min-h-11 shrink-0 items-center" data-testid="link-home">
          {/* telas bem estreitas (< 360 px): só o ícone, para caber ao lado dos botões */}
          <BrandIcon className="min-[360px]:hidden" />
          <span className="hidden min-[360px]:contents">
            <BrandLogo priority />
          </span>
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
