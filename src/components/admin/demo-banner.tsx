"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Eye, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

// Os links usam <a> (e não <Link>) para garantir uma requisição real ao servidor,
// que encerra a sessão da demonstração antes de abrir o cadastro.
const CRIAR_CONTA = "/demo/sair?para=cadastro";
const SAIR = "/demo/sair?para=profissional";

export function DemoBanner() {
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const blocked = params.get("demo") === "bloqueado";

  return (
    <>
      {/* Faixa fixa no topo */}
      <div
        className="sticky top-0 z-40 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 bg-foreground px-4 py-2.5 text-sm text-background md:h-14 md:flex-nowrap md:justify-between md:py-0"
        data-testid="faixa-demo"
      >
        <p className="flex items-center gap-2">
          <Eye className="h-4 w-4 text-[#F2C078]" />
          <span>
            <strong>Você está na demonstração.</strong>{" "}
            <span className="hidden sm:inline">Explore à vontade: as alterações não são salvas.</span>
          </span>
        </p>
        <div className="flex items-center gap-2">
          <Button asChild size="sm" className="h-9" data-testid="btn-demo-criar-conta">
            <a href={CRIAR_CONTA}>Criar minha conta grátis</a>
          </Button>
          <a href={SAIR} className="inline-flex h-9 items-center px-2 text-stone-300 underline hover:text-white" data-testid="btn-demo-sair">
            Sair
          </a>
        </div>
      </div>

      {/* Aviso ao tentar salvar */}
      <Dialog open={blocked} onOpenChange={(o) => !o && router.replace(pathname)}>
        <DialogContent className="max-w-sm rounded-2xl text-center">
          <DialogHeader className="items-center text-center">
            <span className="mb-2 grid h-12 w-12 place-items-center rounded-full bg-secondary text-primary">
              <Lock className="h-6 w-6" />
            </span>
            <DialogTitle className="font-heading text-2xl">Disponível na sua conta</DialogTitle>
            <DialogDescription>
              Na demonstração nada é salvo. Crie sua conta grátis e use tudo por 15 dias, sem cartão.
            </DialogDescription>
          </DialogHeader>
          <Button asChild className="h-12 text-base" data-testid="btn-demo-modal-criar">
            <a href={CRIAR_CONTA}>Criar minha conta grátis</a>
          </Button>
          <Button variant="ghost" className="h-11" onClick={() => router.replace(pathname)}>
            Continuar explorando
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}