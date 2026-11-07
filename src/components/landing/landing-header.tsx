import Link from "next/link";
import { BrandIcon, BrandLogo } from "@/components/brand-logo";
import { LANDING_NAV } from "@/content/landing";
import { cn } from "@/lib/utils";
import { lpBtnOutline, lpBtnSolid, lpWrap } from "./styles";

/** Barra superior fixa da landing: logo · âncoras (some no celular) · Entrar · Testar grátis */
export function LandingHeader() {
  return (
    <header className="sticky top-0 z-40 bg-background/90 backdrop-blur-md">
      <div className={`${lpWrap} flex h-[72px] items-center justify-between gap-2`}>
        <Link href="/" className="flex min-h-11 shrink-0 items-center" data-testid="link-home">
          {/* telas bem estreitas (< 360 px): só o ícone, para caber ao lado dos botões */}
          <BrandIcon className="min-[360px]:hidden" />
          <span className="hidden min-[360px]:contents">
            <BrandLogo priority className="h-7 md:h-[34px]" />
          </span>
        </Link>

        <nav className="flex items-center gap-2 text-[15px]" aria-label={LANDING_NAV.ariaLabel}>
          {LANDING_NAV.links.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="hidden min-h-11 items-center px-2 text-foreground hover:text-primary lg:inline-flex"
              data-testid={l.testid}
            >
              {l.label}
            </a>
          ))}
          <Link
            href={LANDING_NAV.findSpace.href}
            className="mr-2 hidden min-h-11 items-center px-2 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline md:inline-flex"
            data-testid="link-encontrar-espaco"
          >
            {LANDING_NAV.findSpace.label}
          </Link>
          <Link
            href={LANDING_NAV.login.href}
            className={cn(lpBtnOutline, "h-11 px-3.5 text-sm sm:px-5 sm:text-[15px]")}
            data-testid="btn-nav-entrar"
          >
            {LANDING_NAV.login.label}
          </Link>
          <Link
            href={LANDING_NAV.signup.href}
            className={cn(lpBtnSolid, "h-11 px-3.5 text-sm sm:px-5 sm:text-[15px]")}
            data-testid="btn-nav-testar"
          >
            {LANDING_NAV.signup.label}
          </Link>
        </nav>
      </div>
    </header>
  );
}
