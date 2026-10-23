"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BellRing, CalendarDays, CalendarHeart, CalendarOff, CreditCard, ExternalLink, LayoutDashboard,
  HandCoins, Lock, LogOut, Menu, Scissors, Settings, UserRound, Users, Wallet,
} from "lucide-react";
import { signOut } from "@/app/admin/actions";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
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

function NavContent({ businessName, slug, email, lockedHrefs = [], role = "owner", onNavigate }: Props & { onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 px-5 py-5">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
          <CalendarHeart className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <p className="truncate font-heading text-lg leading-tight">{businessName}</p>
          <p className="text-xs text-muted-foreground">Genix Agenda · {ROLE_LABEL[role]}</p>
        </div>
      </div>

      <nav className="flex-1 space-y-0.5 px-3">
        {NAV.filter((i) => i.roles.includes(role)).map(({ href, label, icon: Icon }) => {
          const active = href === "/admin" ? pathname === "/admin" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              onClick={onNavigate}
              data-testid={`nav-${href.split("/").pop()}`}
              className={cn(
                "flex h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors",
                active ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
              )}
            >
              <Icon className={cn("h-[18px] w-[18px]", active && "text-primary")} />
              <span className="flex-1">{label}</span>
              {lockedHrefs.includes(href) && <Lock className="h-3.5 w-3.5 text-muted-foreground" aria-label="Recurso do Completo" />}
            </Link>
          );
        })}
      </nav>

      <div className="space-y-1 border-t p-3">
        <a
          href={`/v/${slug}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
          data-testid="nav-ver-vitrine"
        >
          <ExternalLink className="h-[18px] w-[18px]" /> Ver minha vitrine
        </a>
        <form action={signOut}>
          <button
            type="submit"
            className="flex h-11 w-full items-center gap-3 rounded-lg px-3 text-sm font-medium text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
            data-testid="btn-sair"
          >
            <LogOut className="h-[18px] w-[18px]" /> Sair
          </button>
        </form>
        <p className="truncate px-3 pt-1 text-xs text-muted-foreground">{email}</p>
      </div>
    </div>
  );
}

export function AdminSidebar(props: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Desktop */}
      <aside className="sticky top-0 hidden h-svh w-64 shrink-0 border-r bg-white md:block">
        <NavContent {...props} />
      </aside>

      {/* Mobile: barra superior + menu deslizante */}
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b bg-white/90 px-4 backdrop-blur md:hidden">
        <p className="truncate font-heading text-lg">{props.businessName}</p>
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
