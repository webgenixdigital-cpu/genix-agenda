"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CalendarRange, FileSpreadsheet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

type Chip = { key: string; label: string; href: string; active: boolean };

// 44 px de toque no celular/tablet; ~36 px no desktop
const chip = (active: boolean) =>
  cn(
    "inline-flex h-11 shrink-0 items-center whitespace-nowrap rounded-full border px-3 text-sm font-medium transition-colors lg:h-9 lg:px-2.5",
    active ? "border-primary bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:text-foreground"
  );

/**
 * Barra única do Caixa: atalhos de período · Período · tipo · Baixar CSV.
 * Uma linha só; se não couber, rola na horizontal só dentro dela (a página não).
 * Os filtros são links (ficam na URL); "Período" abre as datas abaixo da barra.
 */
export function CashFilterBar({
  presets,
  periodActive,
  tipos,
  csvHref,
  de,
  ate,
  tipo,
}: {
  presets: Chip[];
  /** período personalizado (nenhum atalho bate com as datas) */
  periodActive: boolean;
  tipos: Chip[];
  csvHref: string;
  de: string;
  ate: string;
  tipo: string | null;
}) {
  const [periodOpen, setPeriodOpen] = useState(periodActive);
  const rowRef = useRef<HTMLDivElement>(null);

  // o chip ativo rola até ficar visível (só a barra rola, nunca a página)
  useEffect(() => {
    const row = rowRef.current;
    const active = row?.querySelector<HTMLElement>("[data-active='true']");
    if (!row || !active) return;
    const left = active.offsetLeft - row.offsetLeft;
    const right = left + active.offsetWidth;
    if (left < row.scrollLeft || right > row.scrollLeft + row.clientWidth)
      row.scrollLeft = Math.max(0, left - (row.clientWidth - active.offsetWidth) / 2);
  }, [de, ate, tipo]);

  return (
    <section className="rounded-2xl border bg-card p-2" aria-label="Filtros do caixa">
      <div className="flex items-center gap-2">
        <div
          ref={rowRef}
          className="scroll-shadow-x flex min-w-0 flex-1 items-center gap-1.5 [scrollbar-width:none] lg:gap-1 [&::-webkit-scrollbar]:hidden"
          data-testid="caixa-barra-filtros"
        >
          {presets.map((p) => (
            <Link
              key={p.key}
              href={p.href}
              scroll={false}
              className={chip(p.active)}
              aria-current={p.active ? "true" : undefined}
              data-active={p.active}
              data-testid={`filtro-periodo-${p.key.replace("_", "-")}`}
            >
              {p.label}
            </Link>
          ))}
          <button
            type="button"
            className={chip(periodActive || periodOpen)}
            aria-expanded={periodOpen}
            aria-controls="caixa-periodo-campos"
            data-active={periodActive}
            onClick={() => setPeriodOpen((o) => !o)}
            data-testid="filtro-periodo-personalizado"
          >
            <CalendarRange className="mr-1.5 h-4 w-4" /> Período
          </button>

          <span className="mx-0.5 h-6 w-px shrink-0 bg-border" aria-hidden />

          <nav className="flex shrink-0 items-center gap-1.5 lg:gap-1" aria-label="Tipo">
            {tipos.map((t) => (
              <Link
                key={t.key}
                href={t.href}
                scroll={false}
                className={chip(t.active)}
                aria-current={t.active ? "true" : undefined}
                data-active={t.active && t.key !== "todos"}
                data-testid={`filtro-tipo-${t.key}`}
              >
                {t.label}
              </Link>
            ))}
          </nav>
        </div>

        {/* fora da parte que rola: sempre visível, à direita */}
        <a
          href={csvHref}
          download
          className={cn(chip(false), "text-foreground")}
          aria-label="Baixar planilha CSV do período"
          data-testid="btn-caixa-baixar-csv"
        >
          <FileSpreadsheet className="h-4 w-4 sm:mr-1.5" />
          <span className="hidden sm:inline">Baixar CSV</span>
          <span className="sm:hidden">&nbsp;CSV</span>
        </a>
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
        <p className="w-full text-xs text-muted-foreground">Até 1 ano entre as datas.</p>
      </form>
    </section>
  );
}
