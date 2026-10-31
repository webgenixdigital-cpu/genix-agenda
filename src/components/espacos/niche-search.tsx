"use client";

// Busca da /espacos: "O que você procura?" (combobox de nichos) + "Onde?".
// Escolher um nicho → ?nicho=id · texto livre → ?q= · "Onde?" → ?onde=
import { useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { MapPin, Search } from "lucide-react";
import { NicheIcon } from "@/components/niche-icon";
import { Button } from "@/components/ui/button";
import { matchNiches, type NicheOption } from "@/lib/niche-match";
import { cn } from "@/lib/utils";

type Option = NicheOption & { icon: string };

export function NicheSearch({
  niches,
  initialNiche,
  initialQ = "",
  initialOnde = "",
  seg,
}: {
  niches: Option[];
  initialNiche?: string;
  initialQ?: string;
  initialOnde?: string;
  /** segmento atual: mantido só quando nenhum nicho é escolhido */
  seg?: string;
}) {
  const router = useRouter();
  const uid = useId();
  const listId = `${uid}-nichos`;
  const preset = niches.find((n) => n.id === initialNiche);

  const [text, setText] = useState(preset?.name ?? initialQ);
  const [selected, setSelected] = useState<Option | null>(preset ?? null);
  const [onde, setOnde] = useState(initialOnde);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);

  // campo vazio: os primeiros nichos; com texto: os que combinam (nome ou sinônimo)
  const options = useMemo(() => (text.trim() ? matchNiches(niches, text) : niches.slice(0, 8)), [niches, text]);
  const showList = open && options.length > 0 && !(selected && selected.name === text);

  function choose(n: Option) {
    setSelected(n);
    setText(n.name);
    setOpen(false);
    setActive(-1);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const p = new URLSearchParams();
    const t = text.trim();
    if (selected && selected.name === text) p.set("nicho", selected.id);
    else if (t) p.set("q", t.slice(0, 60));
    if (onde.trim()) p.set("onde", onde.trim().slice(0, 60));
    if (seg && !p.has("nicho")) p.set("seg", seg);
    const qs = p.toString();
    router.push(`/espacos${qs ? `?${qs}` : ""}#resultados`);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((i) => (options.length ? (i + 1) % options.length : -1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setOpen(true);
      setActive((i) => (options.length ? (i <= 0 ? options.length - 1 : i - 1) : -1));
    } else if (e.key === "Enter" && showList && active >= 0) {
      e.preventDefault();
      choose(options[active]);
    } else if (e.key === "Escape") {
      setOpen(false);
      setActive(-1);
    }
  }

  return (
    <form action="/espacos" onSubmit={submit} role="search" className="mx-auto mt-10 max-w-3xl text-left" data-testid="form-busca-espacos">
      <div className="grid gap-2 rounded-3xl border bg-white p-2 shadow-lg shadow-stone-900/5 md:grid-cols-[1.2fr_1fr_auto] md:rounded-full">
        {/* ---------- O que você procura? (combobox) ---------- */}
        <div className="relative">
          <label htmlFor={`${uid}-o-que`} className="sr-only">O que você procura?</label>
          <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input
            ref={inputRef}
            id={`${uid}-o-que`}
            // sem JavaScript o formulário ainda envia o texto como ?q=
            name={selected && selected.name === text ? undefined : "q"}
            type="text"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={showList}
            aria-controls={listId}
            aria-activedescendant={showList && active >= 0 ? `${listId}-${active}` : undefined}
            autoComplete="off"
            maxLength={60}
            placeholder="O que você procura?"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              if (selected && e.target.value !== selected.name) setSelected(null);
              setOpen(true);
              setActive(-1);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => setOpen(false)}
            onKeyDown={onKeyDown}
            className="h-12 w-full rounded-full bg-transparent pl-12 pr-3 text-base outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
            data-testid="input-busca-nicho"
          />
          {selected && selected.name === text && <input type="hidden" name="nicho" value={selected.id} />}

          {showList && (
            <ul
              id={listId}
              role="listbox"
              aria-label="Tipos de atendimento"
              className="absolute left-0 right-0 top-full z-30 mt-2 max-h-80 overflow-y-auto rounded-2xl border bg-white p-1 shadow-xl"
            >
              {options.map((n, i) => (
                <li
                  key={n.id}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={i === active}
                  // mousedown (e não click) para escolher antes do blur fechar a lista
                  onMouseDown={(e) => {
                    e.preventDefault();
                    choose(n);
                  }}
                  onMouseEnter={() => setActive(i)}
                  className={cn(
                    "flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-3 py-2 text-left",
                    i === active ? "bg-secondary" : "hover:bg-secondary/60"
                  )}
                  data-testid={`opcao-nicho-${n.id}`}
                >
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-secondary text-primary">
                    <NicheIcon name={n.icon} className="h-4 w-4" />
                  </span>
                  <span className="font-medium">{n.name}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* ---------- Onde? ---------- */}
        <div className="relative border-t pt-2 md:border-l md:border-t-0 md:pl-2 md:pt-0">
          <label htmlFor={`${uid}-onde`} className="sr-only">Onde? Nome do espaço ou cidade</label>
          <MapPin className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground md:left-6" aria-hidden />
          <input
            id={`${uid}-onde`}
            name="onde"
            type="text"
            maxLength={60}
            placeholder="Onde? Espaço ou cidade"
            value={onde}
            onChange={(e) => setOnde(e.target.value)}
            className="h-12 w-full rounded-full bg-transparent pl-12 pr-3 text-base outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring md:pl-14"
            data-testid="input-busca-onde"
          />
        </div>

        {seg && !(selected && selected.name === text) && <input type="hidden" name="seg" value={seg} />}
        <Button type="submit" className="h-12 rounded-full px-7 text-base" data-testid="btn-buscar">
          Buscar
        </Button>
      </div>
    </form>
  );
}
