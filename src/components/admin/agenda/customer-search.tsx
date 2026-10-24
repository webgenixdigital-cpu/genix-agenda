"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Loader2, Search, UserRound, X } from "lucide-react";
import { searchCustomers, type CustomerHit } from "@/app/admin/(painel)/agenda/actions";
import { Input } from "@/components/ui/input";
import { maskPhone } from "@/lib/format";
import { cn } from "@/lib/utils";

const br = (iso: string) => iso.split("-").reverse().join("/");

/** Termo suficiente para buscar: 2 letras ou 3 dígitos */
const searchable = (q: string) => q.replace(/\d/g, "").trim().length >= 2 || q.replace(/\D/g, "").length >= 3;

/**
 * Campo de nome com busca de clientes (nome ou WhatsApp).
 * O texto digitado continua sendo o nome: cliente novo funciona como antes.
 */
export function CustomerSearch({
  id,
  value,
  onChange,
  onPick,
  onDigitsOnly,
  onClear,
}: {
  id: string;
  value: string;
  onChange: (name: string) => void;
  /** escolheu um cliente da lista */
  onPick: (c: CustomerHit) => void;
  /** saiu do campo com só números digitados (vai para o WhatsApp) */
  onDigitsOnly?: (digits: string) => void;
  /** botão × : trocar de cliente (limpa nome e WhatsApp) */
  onClear?: () => void;
}) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [hits, setHits] = useState<CustomerHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(-1);
  const [typed, setTyped] = useState(false); // só busca depois que a pessoa digita
  const seq = useRef(0);
  const boxRef = useRef<HTMLDivElement>(null);

  // debounce de 300 ms; só a resposta da busca mais recente é aplicada
  useEffect(() => {
    if (!typed || !searchable(value)) {
      setHits([]);
      setLoading(false);
      return;
    }
    const mine = ++seq.current;
    setLoading(true);
    const t = setTimeout(() => {
      searchCustomers(value).then((r) => {
        if (mine !== seq.current) return; // resposta atrasada de uma busca antiga
        setHits(r ?? []);
        setActive(-1);
        setLoading(false);
      });
    }, 300);
    return () => clearTimeout(t);
  }, [value, typed]);

  // fecha ao clicar fora
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  function pick(c: CustomerHit) {
    seq.current++; // ignora buscas em andamento
    setTyped(false);
    setOpen(false);
    setHits([]);
    setLoading(false);
    onPick(c);
  }

  const showList = open && typed && searchable(value);

  return (
    <div ref={boxRef} className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        id={id}
        className="h-11 pl-9 pr-11"
        autoComplete="off"
        placeholder="Nome ou WhatsApp"
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={active >= 0 && hits[active] ? `${listId}-${active}` : undefined}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setTyped(true);
          setOpen(true);
        }}
        onFocus={() => typed && setOpen(true)}
        onBlur={() => {
          const digits = value.replace(/\D/g, "");
          if (onDigitsOnly && digits.length >= 10 && !/[^\d\s().-]/.test(value)) onDigitsOnly(digits);
        }}
        onKeyDown={(e) => {
          if (!showList) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((i) => Math.min(i + 1, hits.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((i) => Math.max(i - 1, 0));
          } else if (e.key === "Enter" && active >= 0 && hits[active]) {
            e.preventDefault(); // não envia o formulário
            pick(hits[active]);
          } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation(); // fecha só a lista, não o diálogo
            setOpen(false);
          }
        }}
        data-testid="input-busca-cliente"
      />
      {onClear && value && (
        <button
          type="button"
          className="absolute right-0 top-0 grid h-11 w-11 place-items-center text-muted-foreground hover:text-foreground"
          aria-label="Trocar cliente"
          onClick={() => {
            seq.current++;
            setTyped(false);
            setOpen(false);
            onClear();
          }}
          data-testid="btn-limpar-cliente"
        >
          <X className="h-4 w-4" />
        </button>
      )}

      {showList && (
        <div className="absolute inset-x-0 top-full z-50 mt-1 overflow-hidden rounded-xl border bg-popover shadow-lg">
          {loading && hits.length === 0 ? (
            <p className="flex min-h-11 items-center gap-2 px-3 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Buscando…
            </p>
          ) : hits.length === 0 ? (
            <p className="px-3 py-3 text-sm text-muted-foreground">
              Nenhum cliente encontrado — preencha nome e WhatsApp para cadastrar.
            </p>
          ) : (
            <ul id={listId} role="listbox" aria-label="Clientes encontrados" className="max-h-64 overflow-y-auto py-1" data-testid="lista-busca-cliente">
              {hits.map((c, i) => (
                <li
                  key={c.id}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={i === active}
                  className={cn(
                    "flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2 text-sm",
                    i === active ? "bg-secondary" : "hover:bg-secondary/60"
                  )}
                  // pointerdown para escolher antes do blur do campo
                  onPointerDown={(e) => {
                    e.preventDefault();
                    pick(c);
                  }}
                  onMouseEnter={() => setActive(i)}
                  data-testid={`opcao-cliente-${c.id}`}
                >
                  <UserRound className="h-4 w-4 shrink-0 text-primary" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{c.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {maskPhone(c.phone)} · {c.lastVisit ? `última visita ${br(c.lastVisit)}` : "sem visitas"}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
