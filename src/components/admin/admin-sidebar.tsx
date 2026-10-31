"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BellRing, CalendarDays, CalendarOff, CreditCard, ExternalLink, LayoutDashboard,
  HandCoins, Lock, LogOut, Menu, PanelLeftClose, PanelLeftOpen, Scissors, Settings, UserRound, Users, Wallet,
} from "lucide-react";
import { signOut } from "@/app/admin/actions";
import { BrandIcon, BrandLogo } from "@/components/brand-logo";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { SIDEBAR_COOKIE, setPrefCookie } from "@/lib/ui-prefs";
import { cn } from "@/lib/utils";

type Role = "owner" | "reception" | "staff" | "viewer";
const ALL: Role[] = ["owner", "reception", "staff", "viewer"];
const OWNER: Role[] = ["owner", "viewer"];

const NAV: { href: string; label: string; icon: typeof LayoutDashboard; roles: Role[] }[] = [
  { href: "/admin", label: "Início", icon: LayoutDashboard, roles: ALL },
  { href: "/admin/agenda", label: "Agenda", icon: CalendarDays, roles: ALL },
  { href: "/admin/clientes", label: "Clientes", icon: UserRound, roles: ALL },
  { href: "/admin/lembretes", label: "Lembretes", icon: BellRing, roles: ALL },
  { href: "/admin/bloqueios", label: "Bloqueios", icon: CalendarOff, roles: ALL },
  { href: "/admin/ganhos", label: "Meus ganhos", icon: HandCoins, roles: ["staff"] },
  { href: "/admin/servicos", label: "Serviços", icon: Scissors, roles: OWNER },
  { href: "/admin/profissionais", label: "Equipe", icon: Users, roles: OWNER },
  { href: "/admin/financeiro", label: "Financeiro", icon: Wallet, roles: OWNER },
  { href: "/admin/assinatura", label: "Assinatura", icon: CreditCard, roles: ["owner"] },
  { href: "/admin/configuracoes", label: "Configurações", icon: Settings, roles: OWNER },
];

const ROLE_LABEL: Record<Role, string> = {
  owner: "Matriz",
  reception: "Recepção",
  staff: "Profissional",
  viewer: "Demonstração",
};

type Props = { businessName: string; slug: string; email: string; lockedHrefs?: string[]; role?: Role };

const ITEM = "flex h-11 items-center gap-3 rounded-lg text-sm font-medium transition-colors";

function NavContent({
  businessName, slug, email, lockedHrefs = [], role = "owner", onNavigate, collapsed = false, onToggle,
}: Props & { onNavigate?: () => void; collapsed?: boolean; onToggle?: () => void }) {
  const pathname = usePathname();
  const toggleLabel = collapsed ? "Expandir menu" : "Recolher menu";

  // Nome do item no menu recolhido (hover/foco pelo teclado). Fica em position: fixed para não ser
  // cortado pela rolagem da lista; o texto para leitor de tela continua no sr-only de cada item.
  const [tip, setTip] = useState<{ label: string; top: number } | null>(null);
  const hideTip = () => setTip(null);
  const tipProps = (label: string) =>
    collapsed
      ? {
          onMouseEnter: (e: React.MouseEvent<HTMLElement>) => {
            const r = e.currentTarget.getBoundingClientRect();
            setTip({ label, top: r.top + r.height / 2 });
          },
          onFocus: (e: React.FocusEvent<HTMLElement>) => {
            if (!e.currentTarget.matches(":focus-visible")) return;
            const r = e.currentTarget.getBoundingClientRect();
            setTip({ label, top: r.top + r.height / 2 });
          },
          onMouseLeave: hideTip,
          onBlur: hideTip,
        }
      : {};

  const toggle = onToggle && (
    <button
      type="button"
      onClick={() => {
        hideTip();
        onToggle();
      }}
      aria-label={toggleLabel}
      aria-expanded={!collapsed}
      className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
      data-testid="btn-recolher-menu"
      {...tipProps(toggleLabel)}
    >
      {collapsed ? <PanelLeftOpen className="h-[18px] w-[18px]" /> : <PanelLeftClose className="h-[18px] w-[18px]" />}
    </button>
  );

  return (
    <div className="flex h-full flex-col">
      {/* Topo com altura própria: nunca encolhe nem fica por baixo da lista */}
      {collapsed ? (
        <div className="flex shrink-0 flex-col items-center gap-1 border-b py-3">
          <BrandIcon />
          {toggle}
        </div>
      ) : (
        <div className="shrink-0">
          <div className="flex h-16 items-center justify-between gap-2 pl-5 pr-3">
            <BrandLogo className="shrink-0" />
            {toggle}
          </div>
          <div className="min-w-0 px-5 pb-4">
            <p className="truncate font-heading text-lg leading-tight">{businessName}</p>
            <p className="text-xs text-muted-foreground">{ROLE_LABEL[role]}</p>
          </div>
        </div>
      )}

      {/* Lista: ocupa o meio e rola em janelas baixas */}
      <nav
        className={cn(
          "min-h-0 flex-1 space-y-0.5 overflow-y-auto overflow-x-hidden [scrollbar-width:thin]",
          collapsed ? "px-2 py-2" : "px-3 pb-2"
        )}
        onScroll={hideTip}
      >
        {NAV.filter((i) => i.roles.includes(role)).map(({ href, label, icon: Icon }) => {
          const active = href === "/admin" ? pathname === "/admin" : pathname.startsWith(href);
          const locked = lockedHrefs.includes(href);
          return (
            <Link
              key={href}
              href={href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              data-testid={`nav-${href.split("/").pop()}`}
              className={cn(
                ITEM,
                "relative",
                collapsed ? "justify-center" : "px-3",
                active ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
              )}
              {...tipProps(locked ? `${label} (planos pagos)` : label)}
            >
              <Icon className={cn("h-[18px] w-[18px] shrink-0", active && "text-primary")} />
              <span className={collapsed ? "sr-only" : "flex-1 truncate"}>{label}</span>
              {locked && (
                <Lock
                  className={cn("text-muted-foreground", collapsed ? "absolute right-1 top-1 h-3 w-3" : "h-3.5 w-3.5")}
                  aria-label="Recurso dos planos pagos"
                />
              )}
            </Link>
          );
        })}
      </nav>

      <div className={cn("shrink-0 space-y-1 border-t", collapsed ? "p-2" : "p-3")}>
        <a
          href={`/v/${slug}`}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(ITEM, "text-muted-foreground hover:bg-secondary/60 hover:text-foreground", collapsed ? "justify-center" : "px-3")}
          data-testid="nav-ver-vitrine"
          {...tipProps("Ver minha vitrine")}
        >
          <ExternalLink className="h-[18px] w-[18px] shrink-0" />
          <span className={collapsed ? "sr-only" : "truncate"}>Ver minha vitrine</span>
        </a>
        <form action={signOut}>
          <button
            type="submit"
            className={cn(ITEM, "w-full text-muted-foreground hover:bg-secondary/60 hover:text-foreground", collapsed ? "justify-center" : "px-3")}
            data-testid="btn-sair"
            {...tipProps("Sair")}
          >
            <LogOut className="h-[18px] w-[18px] shrink-0" />
            <span className={collapsed ? "sr-only" : undefined}>Sair</span>
          </button>
        </form>
        {!collapsed && <p className="truncate px-3 pt-1 text-xs text-muted-foreground">{email}</p>}
      </div>

      {collapsed && tip && (
        <span
          aria-hidden
          className="pointer-events-none fixed left-[4.5rem] z-50 -translate-y-1/2 whitespace-nowrap rounded-md bg-foreground px-2.5 py-1.5 text-xs font-medium text-background shadow-md"
          style={{ top: tip.top }}
          data-testid="menu-dica"
        >
          {tip.label}
        </span>
      )}
    </div>
  );
}

export function AdminSidebar({
  initialCollapsed = false,
  belowDemoBanner = false,
  ...props
}: Props & { initialCollapsed?: boolean; belowDemoBanner?: boolean }) {
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(initialCollapsed);

  function toggle() {
    const next = !collapsed;
    setCollapsed(next);
    setPrefCookie(SIDEBAR_COOKIE, next ? "collapsed" : null);
  }

  return (
    <>
      {/* Desktop: recolhível (estado no cookie, lido no layout do painel) */}
      <aside
        className={cn(
          // z-30: o nome no hover (menu recolhido) passa por cima do conteúdo, como a grade semanal
          "sticky z-30 hidden shrink-0 overflow-hidden border-r bg-white transition-[width] duration-200 ease-out md:block",
          // demo: começa abaixo da faixa fixa (md:h-14) para o topo do menu não ficar por baixo dela
          belowDemoBanner ? "top-14 h-[calc(100svh-3.5rem)]" : "top-0 h-svh",
          collapsed ? "w-16" : "w-64"
        )}
        data-state={collapsed ? "collapsed" : "expanded"}
        data-testid="menu-lateral"
      >
        <NavContent {...props} collapsed={collapsed} onToggle={toggle} />
      </aside>

      {/* Mobile: barra superior + menu deslizante */}
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b bg-white/90 px-4 backdrop-blur md:hidden">
        <div className="flex min-w-0 items-center gap-2">
          <BrandIcon className="shrink-0" />
          <p className="truncate font-heading text-lg">{props.businessName}</p>
        </div>
        <Button variant="ghost" size="icon" onClick={() => setOpen(true)} aria-label="Abrir menu" data-testid="btn-menu-mobile">
          <Menu className="h-5 w-5" />
        </Button>
      </header>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="w-72 p-0">
          <SheetTitle className="sr-only">Menu do painel</SheetTitle>
          <NavContent {...props} onNavigate={() => setOpen(false)} />
        </SheetContent>
      </Sheet>
    </>
  );
}
