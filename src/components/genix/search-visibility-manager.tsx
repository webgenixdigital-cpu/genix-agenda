"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { setSearchHidden } from "@/app/genix/search-actions";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

/** Linha de genix_search_overview() (migration 30) */
export type SearchOverview = {
  business_id: string;
  name: string;
  slug: string;
  is_published: boolean;
  is_demo: boolean;
  search_hidden: boolean;
};

export function SearchVisibilityManager({ rows, missing }: { rows: SearchOverview[]; missing: boolean }) {
  const [q, setQ] = useState("");
  const list = rows.filter((r) => `${r.name} ${r.slug}`.toLowerCase().includes(q.trim().toLowerCase()));

  if (missing) {
    return (
      <p className="max-w-2xl rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        Rode a migration 30 (ocultar dos buscadores) no SQL Editor do Supabase para usar esta aba.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <p className="max-w-2xl text-sm text-muted-foreground">
        Espaço oculto sai do sitemap e a vitrine ganha “noindex”: o Google deixa de mostrar. A vitrine e o agendamento
        continuam funcionando normalmente. Contas novas nascem visíveis; a demonstração nunca vai ao Google.
      </p>
      <Input
        className="h-11 max-w-sm"
        placeholder="Buscar espaço"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        data-testid="input-busca-buscadores"
      />
      <ul className="divide-y rounded-xl border bg-white">
        {list.map((r) => (
          <SearchRow key={r.business_id} row={r} />
        ))}
        {list.length === 0 ? <li className="p-4 text-sm text-muted-foreground">Nenhum espaço encontrado.</li> : null}
      </ul>
    </div>
  );
}

function SearchRow({ row }: { row: SearchOverview }) {
  const [pending, start] = useTransition();
  const [hidden, setHidden] = useState(row.search_hidden);

  function change(next: boolean) {
    setHidden(next);
    start(async () => {
      const r = await setSearchHidden(row.business_id, row.slug, next);
      if (!r) return;
      if (r.ok) toast.success(next ? `${row.name} oculto dos buscadores` : `${row.name} visível nos buscadores`);
      else {
        setHidden(!next);
        toast.error(r.error);
      }
    });
  }

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 p-4">
      <div className="min-w-0">
        <p className="font-medium">{row.name}</p>
        <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          /v/{row.slug}
          <Badge className={row.is_published ? "bg-green-100 text-green-800" : "bg-stone-100 text-stone-700"}>
            {row.is_published ? "Publicado" : "Não publicado"}
          </Badge>
          {row.is_demo ? <Badge className="bg-amber-100 text-amber-900">Demonstração</Badge> : null}
        </p>
      </div>
      <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
        Ocultar dos buscadores (Google)
        <Switch
          checked={hidden}
          onCheckedChange={change}
          disabled={pending}
          data-testid={`switch-ocultar-buscadores-${row.slug}`}
        />
      </label>
    </li>
  );
}

function Badge({ className, children }: { className: string; children: React.ReactNode }) {
  return <span className={cn("rounded-full px-2 py-0.5 font-medium", className)}>{children}</span>;
}
