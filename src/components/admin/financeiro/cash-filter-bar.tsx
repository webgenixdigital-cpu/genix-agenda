"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowDownRight, ArrowUpDown, ArrowUpRight, CalendarRange, Check, ChevronDown, FileSpreadsheet } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

type Preset = { key: string; label: string; short: string; href: string; active: boolean };
type Tipo = { key: "todos" | "entrada" | "saida"; label: string; href: string; active: boolean };

const TIPO_ICON = { todos: ArrowUpDown, entrada: ArrowUpRight, saida: ArrowDownRight } as const;

// 44 px de toque no celular/tablet; ~36 px no desktop
const H = "h-11 lg:h-9";

/**
 * Barra do Caixa numa linha só, em qualquer largura:
 * [Período ▾] · [Todos | Entradas | Saídas] · [CSV]
 * O período é um menu (atalhos + "Período..." que abre as datas abaixo da barra).
 */
export function CashFilterBar({
  presets,
  customLabel,
  tipos,
  csvHref,
  de,
  ate,
  tipo,
}: {
  presets: Preset[];
  /** rótulo do período personalizado ("01/11 – 10/11"); null quando um atalho está ativo */
  customLabel: string | null;
  tipos: Tipo[];
  csvHref: string;
  de: string;
  ate: string;
  tipo: string | null;
}) {
  const [periodOpen, setPeriodOpen] = useState(false);
  const active = presets.find((p) => p.active);
  const label = active?.label ?? customLabel ?? "Período";
  const short = active?.short ?? customLabel ?? "Período";

  return (
    <section className="rounded-2xl border bg-card p-1.5 sm:p-2" aria-label="Filtros do caixa">
      <div className="flex items-center gap-1 sm:gap-2" data-testid="caixa-barra-filtros">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              className={cn(H, "min-w-0 flex-1 justify-between gap-0.5 rounded-full px-2 text-sm font-medium sm:flex-none sm:gap-1.5 sm:px-3")}
              title={label}
              data-testid="filtro-periodo-menu"
            >
              <CalendarRange className="hidden h-4 w-4 shrink-0 sm:block" aria-hidden />
              <span className="truncate sm:hidden">{short}</span>
              <span className="hidden truncate sm:inline">{label}</span>
              <ChevronDown className="h-4 w-4 shrink-0 opacity-70" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-52">
            {presets.map((p) => (
              <DropdownMenuItem key={p.key} asChild className="min-h-11 lg:min-h-9">
                <Link href={p.href} scroll={false} data-testid={`filtro-periodo-${p.key.replace("_", "-")}`}>
                  <Check className={cn("h-4 w-4", !p.active && "invisible")} aria-hidden />
                  {p.label}
                </Link>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="min-h-11 lg:min-h-9"
              onSelect={() => setPeriodOpen(true)}
              data-testid="filtro-periodo-personalizado"
            >
              <Check className={cn("h-4 w-4", !customLabel && "invisible")} aria-hidden />
              Período...
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* tipo: controle segmentado; no celular só ícones (o nome fica no aria-label) */}
        <nav className="flex shrink-0 items-center rounded-full border" aria-label="Tipo de lançamento">
          {tipos.map((t) => {
            const Icon = TIPO_ICON[t.key];
            return (
              <Link
                key={t.key}
                href={t.href}
                scroll={false}
                aria-label={t.label}
                title={t.label}
                aria-current={t.active ? "true" : undefined}
                className={cn(
                  "inline-flex h-11 min-w-11 items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-2 text-sm font-medium transition-colors sm:px-3 lg:h-9 lg:min-w-0",
                  t.active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                )}
                data-testid={`filtro-tipo-${t.key}`}
              >
                <Icon className="h-4 w-4 sm:hidden" aria-hidden />
                <span className="hidden sm:inline">{t.label}</span>
              </Link>
            );
          })}
        </nav>

        <Button asChild variant="outline" className={cn(H, "min-w-11 shrink-0 rounded-full px-3 text-sm sm:ml-auto")}>
          <a href={csvHref} download aria-label="Baixar planilha CSV do período" data-testid="btn-caixa-baixar-csv">
            <FileSpreadsheet className="h-4 w-4" aria-hidden />
            <span className="hidden sm:inline">Baixar CSV</span>
          </a>
        </Button>
      </div>

      {/* "hidden" + "flex" não combinam no Tailwind (a classe vence): esconde por classe */}
      <form
        id="caixa-periodo-campos"
        action="/admin/financeiro"
        method="get"
        className={cn("mt-2 flex-wrap items-end gap-3 border-t px-2 pb-2 pt-3", periodOpen ? "flex" : "hidden")}
      >
        {tipo && <input type="hidden" name="tipo" value={tipo} />}
        <div className="space-y-1.5">
          <Label htmlFor="caixa-de">Data inicial</Label>
          <Input id="caixa-de" name="de" type="date" required defaultValue={de} className="h-11 w-44" data-testid="input-caixa-de" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="caixa-ate">Data final</Label>
          <Input id="caixa-ate" name="ate" type="date" required defaultValue={ate} className="h-11 w-44" data-testid="input-caixa-ate" />
        </div>
        <Button type="submit" className="h-11" data-testid="btn-caixa-aplicar-periodo">
          Aplicar
        </Button>
        <Button type="button" variant="ghost" className="h-11" onClick={() => setPeriodOpen(false)} data-testid="btn-caixa-fechar-periodo">
          Fechar
        </Button>
        <p className="w-full text-xs text-muted-foreground">Até 1 ano entre as datas.</p>
      </form>
    </section>
  );
}
