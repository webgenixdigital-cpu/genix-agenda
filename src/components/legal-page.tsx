import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { LEGAL } from "@/lib/legal";

/** Layout de leitura para páginas jurídicas */
export function LegalPage({
  title,
  updatedAt = LEGAL.atualizadoEm,
  children,
}: {
  title: string;
  /** data própria da página (padrão: a data geral em lib/legal) */
  updatedAt?: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-4 py-12 md:px-6 md:py-16">
        <h1 className="text-4xl md:text-5xl">{title}</h1>
        <p className="mt-3 text-sm text-muted-foreground">Última atualização: {updatedAt}</p>
        <div
          className="mt-10 space-y-8 leading-relaxed text-stone-800
            [&_h2]:font-heading [&_h2]:text-2xl [&_h2]:text-foreground
            [&_li]:ml-5 [&_li]:list-disc [&_li]:pl-1 [&_p]:mt-3 [&_ul]:mt-3 [&_ul]:space-y-1.5"
        >
          {children}
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
