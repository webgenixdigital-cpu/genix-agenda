import Link from "next/link";
import { CalendarHeart } from "lucide-react";
import { Button } from "@/components/ui/button";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-border/80 bg-white/85 backdrop-blur-xl backdrop-saturate-150">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 md:px-6">
        <Link href="/" className="flex items-center gap-2" data-testid="link-home">
          <span className="grid h-9 w-9 place-items-center rounded-full bg-primary text-primary-foreground">
            <CalendarHeart className="h-5 w-5" />
          </span>
          <span className="font-heading text-xl tracking-tight">Genix Agenda</span>
        </Link>
        <Button asChild variant="outline" size="sm" data-testid="btn-area-profissional">
          <Link href="/profissional">Área do profissional</Link>
        </Button>
      </div>
    </header>
  );
}