"use client";

// PhoneInput carregado sob demanda: a libphonenumber (lista de países e
// leitura de "+351…") só baixa quando um campo de telefone aparece na tela.
// Enquanto carrega, mostra um campo comum com a mesma altura (sem pular layout).

import dynamic from "next/dynamic";
import { Input } from "@/components/ui/input";
import type { PhoneInputProps } from "@/components/phone-input";
import { cn } from "@/lib/utils";

export const PhoneInput = dynamic<PhoneInputProps>(
  () => import("@/components/phone-input").then((m) => m.PhoneInput),
  {
    ssr: false,
    loading: () => (
      <div className="flex min-w-0 gap-2" aria-busy="true">
        <div className="h-11 w-[5.5rem] shrink-0 animate-pulse rounded-md border border-input bg-secondary/40" />
        <Input className={cn("h-11 min-w-0 flex-1")} disabled placeholder="(35) 99999-9999" aria-label="Carregando campo de telefone" />
      </div>
    ),
  }
);
