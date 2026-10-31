import Image from "next/image";
import { cn } from "@/lib/utils";

/**
 * Logo horizontal do Genix Agenda (proporção 300 × 64).
 * tone="auto": versão clara, trocada pela escura quando o tema escuro (`.dark`) estiver ativo;
 * tone="escuro": sempre a versão para fundo escuro (ex.: painéis laterais do login e cadastro).
 */
export function BrandLogo({
  tone = "auto",
  className,
  priority,
}: {
  tone?: "auto" | "escuro";
  className?: string;
  priority?: boolean;
}) {
  const size = "h-8 w-auto";
  if (tone === "escuro") {
    return (
      <Image src="/brand/logo-horizontal-escuro.svg" alt="Genix Agenda" width={150} height={32} unoptimized priority={priority} className={cn(size, className)} />
    );
  }
  return (
    <>
      <Image src="/brand/logo-horizontal-claro.svg" alt="Genix Agenda" width={150} height={32} unoptimized priority={priority} className={cn(size, "dark:hidden", className)} />
      <Image src="/brand/logo-horizontal-escuro.svg" alt="Genix Agenda" width={150} height={32} unoptimized className={cn(size, "hidden dark:block", className)} />
    </>
  );
}

/** Ícone quadrado do Genix Agenda, para onde o logo horizontal não cabe */
export function BrandIcon({ className }: { className?: string }) {
  return <Image src="/brand/icone.svg" alt="Genix Agenda" width={32} height={32} unoptimized className={cn("h-8 w-8", className)} />;
}
