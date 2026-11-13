"use client";

// Campo único de telefone de cliente com seletor de país (45).
// Brasil (+55) vem pré-selecionado e mantém a máscara (35) 99999-9999.
// Outros países: número nacional (sem o código do país) em grupos.
// Colar/digitar "+351 912 345 678" (ou "00351…") troca o país sozinho, e o
// código do próprio país digitado no começo sai (mesma regra do banco).
// Use pelo phone-input-lazy.tsx: a libphonenumber só carrega quando o campo aparece.

import { useMemo, useRef, useState } from "react";
import { ChevronDown, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { BR, cleanCountry, displayPhone, normalizePhone } from "@/lib/phone";
import { parseInternational, phoneCountries, regionOf, type PhoneCountry } from "@/lib/phone-intl";
import { cn } from "@/lib/utils";

export type PhoneInputProps = {
  id: string;
  /** texto exibido (número nacional, já formatado) */
  value: string;
  /** código do país, só dígitos ("55", "351"...) */
  country: string;
  onChange: (value: string, country: string) => void;
  disabled?: boolean;
  className?: string;
  inputClassName?: string;
  /** data-testid do campo; o seletor usa `${testId}-pais` */
  testId: string;
  placeholder?: string;
  autoComplete?: string;
};

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function PhoneInput({
  id,
  value,
  country,
  onChange,
  disabled,
  className,
  inputClassName,
  testId,
  placeholder,
  autoComplete = "tel-national",
}: PhoneInputProps) {
  const c = cleanCountry(country);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  // +1 é EUA e Canadá: a bandeira escolhida fica guardada aqui
  const [picked, setPicked] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { priority, rest } = useMemo(() => phoneCountries(), []);
  const all = useMemo(() => [...priority, ...rest], [priority, rest]);
  const region =
    (picked && all.find((x) => x.iso === picked && x.code === c)?.iso) || regionOf(c, value.replace(/\D/g, ""));
  const current = all.find((x) => x.iso === region) ?? all.find((x) => x.code === c);

  const q = fold(query.trim()).replace(/^\+/, "");
  const match = (x: PhoneCountry) => !q || fold(x.name).includes(q) || x.code.startsWith(q) || x.iso.toLowerCase() === q;
  const top = priority.filter(match);
  const others = rest.filter(match);

  function handleText(text: string) {
    const t = text.trimStart();
    // número com o código do país ("+351…" ou "00351…"): troca o país e tira o código
    if (/^(\+|00)\d/.test(t)) {
      const intl = parseInternational(t);
      if (intl) {
        if (intl.region) setPicked(intl.region);
        onChange(displayPhone(intl.national, intl.country), intl.country);
        return;
      }
      // número ainda curto: acha o código pelo prefixo (o maior que existir)
      const d = t.replace(/^00/, "").replace(/\D/g, "");
      const code = [3, 2, 1].map((n) => d.slice(0, n)).find((p) => p.length > 0 && all.some((x) => x.code === p));
      if (code && d.length > code.length) {
        onChange(displayPhone(d.slice(code.length), code), code);
        return;
      }
      // ainda digitando o código: mostra como está
      onChange(`+${d}`, c);
      return;
    }
    onChange(displayPhone(normalizePhone(t, c), c), c);
  }

  function pick(x: PhoneCountry) {
    setPicked(x.iso);
    setOpen(false);
    setQuery("");
    onChange(displayPhone(normalizePhone(value, x.code), x.code), x.code);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  const item = (x: PhoneCountry) => (
    <li key={x.iso}>
      <button
        type="button"
        onClick={() => pick(x)}
        className={cn(
          "flex min-h-11 w-full items-center gap-3 rounded-md px-2 text-left text-sm hover:bg-secondary focus-visible:bg-secondary focus-visible:outline-none",
          x.iso === current?.iso && "bg-secondary font-medium"
        )}
        data-testid={`btn-pais-${x.iso.toLowerCase()}`}
      >
        <span className="text-lg leading-none" aria-hidden>{x.flag}</span>
        <span className="min-w-0 flex-1 truncate">{x.name}</span>
        <span className="shrink-0 text-muted-foreground">+{x.code}</span>
      </button>
    </li>
  );

  return (
    <div className={cn("flex min-w-0 gap-2", className)}>
      <Popover
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) setQuery("");
        }}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            aria-label={`País do telefone: ${current?.name ?? "Brasil"} (+${c}). Trocar país`}
            className={cn(
              "flex h-11 shrink-0 items-center gap-1.5 rounded-md border border-input bg-background px-2.5 text-sm hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50",
              inputClassName?.includes("h-12") && "h-12"
            )}
            data-testid={`${testId}-pais`}
          >
            <span className="text-lg leading-none" aria-hidden>{current?.flag ?? "🇧🇷"}</span>
            <span className="tabular-nums">+{c}</span>
            <ChevronDown className="h-4 w-4 text-muted-foreground" aria-hidden />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[min(20rem,calc(100vw-2rem))] p-2">
          <div className="relative mb-2">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar país ou código"
              aria-label="Buscar país ou código"
              className="h-11 pl-8"
              data-testid={`${testId}-pais-busca`}
            />
          </div>
          <ul className="max-h-[min(50svh,20rem)] overflow-y-auto" aria-label="Países">
            {top.map(item)}
            {top.length > 0 && others.length > 0 && <li aria-hidden className="my-1 border-t" />}
            {others.map(item)}
            {top.length + others.length === 0 && (
              <li className="px-2 py-3 text-sm text-muted-foreground">Nenhum país encontrado.</li>
            )}
          </ul>
        </PopoverContent>
      </Popover>
      <Input
        ref={inputRef}
        id={id}
        className={cn("h-11 min-w-0 flex-1", inputClassName)}
        inputMode="tel"
        autoComplete={autoComplete}
        placeholder={placeholder ?? (c === BR ? "(35) 99999-9999" : "Número com código de área")}
        value={value}
        onChange={(e) => handleText(e.target.value)}
        disabled={disabled}
        data-testid={testId}
      />
    </div>
  );
}

