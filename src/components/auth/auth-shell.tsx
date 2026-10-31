import Link from "next/link";
import { BrandLogo } from "@/components/brand-logo";

/** Moldura simples das telas de conta (esqueci / redefinir senha) */
export function AuthShell({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="grid min-h-svh place-items-center bg-secondary/50 p-4">
      <div className="w-full max-w-md">
        <Link href="/" className="mx-auto mb-6 flex min-h-11 w-fit items-center" data-testid="link-home">
          <BrandLogo priority />
        </Link>
        <div className="rounded-2xl border bg-card p-6 shadow-sm md:p-8">
          <h1 className="text-3xl">{title}</h1>
          {subtitle && <p className="mt-2 text-muted-foreground">{subtitle}</p>}
          <div className="mt-6">{children}</div>
        </div>
      </div>
    </div>
  );
}
