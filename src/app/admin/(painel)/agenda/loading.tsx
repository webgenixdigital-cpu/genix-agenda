import { Skeleton } from "@/components/ui/skeleton";

// Esqueleto da Agenda (serve para Dia e Semana)
export default function AgendaLoading() {
  return (
    <main className="mx-auto max-w-7xl space-y-6 p-4 md:p-8" aria-busy="true" aria-label="Carregando agenda">
      <div className="flex items-end justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-9 w-48" />
          <Skeleton className="h-4 w-64" />
        </div>
        <Skeleton className="h-11 w-44" />
      </div>
      <div className="flex flex-wrap gap-2">
        <Skeleton className="h-11 w-40" />
        <Skeleton className="h-11 w-56" />
        <Skeleton className="h-11 w-44" />
      </div>
      {/* celular: lista */}
      <div className="space-y-3 md:hidden">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-28 w-full rounded-2xl" />
        ))}
      </div>
      {/* tablet/desktop: grade */}
      <div className="hidden overflow-hidden rounded-2xl border bg-card md:block">
        <div className="grid" style={{ gridTemplateColumns: "3.5rem repeat(7, minmax(0, 1fr))" }}>
          <div className="border-b" />
          {Array.from({ length: 7 }, (_, i) => (
            <div key={i} className="space-y-1 border-b border-l p-2">
              <Skeleton className="mx-auto h-3 w-8" />
              <Skeleton className="mx-auto h-5 w-12" />
            </div>
          ))}
          {Array.from({ length: 10 }, (_, r) => (
            <div key={r} className="contents">
              <div className="h-11 border-b border-dashed" />
              {Array.from({ length: 7 }, (_, c) => (
                <div key={c} className="h-11 border-b border-l border-dashed p-1">
                  {(r * 7 + c) % 5 === 0 && <Skeleton className="h-full w-full rounded-lg" />}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
