import Link from "next/link";
import { Check, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LOCKED_FEATURES, type LockedFeatureKey } from "@/lib/plan-features";

export function LockedFeature({ feature }: { feature: LockedFeatureKey }) {
  const f = LOCKED_FEATURES[feature];

  return (
    <main className="mx-auto max-w-2xl p-4 md:p-8" data-testid={`recurso-bloqueado-${feature}`}>
      <div className="rounded-3xl border bg-card p-6 text-center md:p-10">
        <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-secondary text-primary">
          <Lock className="h-6 w-6" />
        </span>
        <p className="mt-5 text-sm font-semibold text-primary">Recurso do plano Completo</p>
        <h1 className="mt-1 text-3xl md:text-4xl">{f.title}</h1>
        <p className="mx-auto mt-3 max-w-md text-muted-foreground">{f.description}</p>

        <ul className="mx-auto mt-6 max-w-sm space-y-2.5 text-left">
          {f.bullets.map((b) => (
            <li key={b} className="flex gap-2.5">
              <Check className="mt-0.5 h-5 w-5 shrink-0 text-primary" /> {b}
            </li>
          ))}
        </ul>

        <Button asChild className="mt-8 h-12 px-8 text-base" data-testid="btn-liberar-completo">
          <Link href="/admin/assinatura">Liberar acesso completo</Link>
        </Button>
      </div>
    </main>
  );
}
