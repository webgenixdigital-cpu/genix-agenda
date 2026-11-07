"use client";

import { useState } from "react";
import { LANDING_IMPLICATION } from "@/content/landing";

/** R$ sem centavos, como no protótipo ("R$ 8.320") */
const brl0 = (n: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0, minimumFractionDigits: 0 }).format(n);

const inputCls =
  "h-[52px] w-full rounded-[14px] border-0 bg-white px-4 text-lg text-foreground outline-none focus-visible:ring-2 focus-visible:ring-[#F2C078]";

/** Calculadora de faltas: faltas/semana × valor médio × 52 = perda por ano (e por mês) */
export function LossCalculator() {
  const c = LANDING_IMPLICATION.calc;
  const [misses, setMisses] = useState(String(c.defaultMisses));
  const [price, setPrice] = useState(String(c.defaultPrice));

  const num = (s: string) => Math.max(0, Number(s.replace(",", ".")) || 0);
  const year = num(misses) * num(price) * c.weeksPerYear;

  return (
    <div className="lp-reveal mx-auto grid max-w-[880px] items-end gap-8 rounded-[28px] bg-[#2a2420] p-8 text-center md:grid-cols-[1fr_1fr_1.2fr] md:p-12 md:text-left">
      <div>
        <label htmlFor="calc-faltas" className="mb-2 block text-sm text-stone-300">{c.missesLabel}</label>
        <input
          id="calc-faltas"
          type="number"
          inputMode="numeric"
          min={0}
          max={500}
          value={misses}
          onChange={(e) => setMisses(e.target.value)}
          className={inputCls}
          data-testid="input-calc-faltas"
        />
      </div>
      <div>
        <label htmlFor="calc-valor" className="mb-2 block text-sm text-stone-300">{c.priceLabel}</label>
        <input
          id="calc-valor"
          type="number"
          inputMode="decimal"
          min={0}
          max={100000}
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          className={inputCls}
          data-testid="input-calc-valor"
        />
      </div>
      <div aria-live="polite">
        <p className="mb-2 text-sm text-stone-300">{c.resultLabel}</p>
        <p className="break-words font-heading text-[length:clamp(36px,5vw,52px)] leading-none text-[#F2C078]" data-testid="calc-perda-ano">
          {brl0(year)}
        </p>
        <p className="mt-2 text-sm text-stone-300">
          {brl0(year / 12)} {c.perMonth}
        </p>
      </div>
    </div>
  );
}
